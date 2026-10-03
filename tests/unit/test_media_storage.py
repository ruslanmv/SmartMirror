"""Issue #4: private storage, validation, signed expiring links, retention."""
import io
import json
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import boto3
import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
from PIL import Image

from services.api.app.database import SessionLocal
from services.api.app.main import app
from services.api.app.models import Asset, WardrobeItem
from smartmirror import media, wardrobe
from smartmirror.privacy import delete_profile_data
from smartmirror.storage import LocalMediaStore, PublicBucketError, S3MediaStore, set_store


def jpeg(color=(30, 60, 200)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(out, "JPEG")
    return out.getvalue()


@pytest.fixture
def store(tmp_path):
    s = LocalMediaStore(tmp_path / "media")
    set_store(s)
    yield s
    set_store(None)


def _capture(store, profile, *, ttl_hours=24, color=(30, 60, 200)):
    with SessionLocal() as db:
        asset = media.ingest(db, store, profile_id=profile, kind="capture", data=jpeg(color), ttl_hours=ttl_hours)
        db.expunge(asset)
        return asset


# ── validation ──────────────────────────────────────────────────────


def test_rejects_decompression_bombs():
    out = io.BytesIO()
    Image.new("1", (7000, 6000)).save(out, "PNG")  # 42 MP in a few kilobytes
    assert len(out.getvalue()) < 100_000
    with pytest.raises(media.MediaRejected, match="too many pixels"):
        media.normalize_image(out.getvalue())


def test_rejects_wrong_type_and_oversize_data_urls():
    with pytest.raises(media.MediaRejected):
        media.decode_data_url("data:image/gif;base64,R0lGOD", 1000)
    with pytest.raises(media.MediaRejected, match="too large"):
        media.decode_data_url("data:image/jpeg;base64," + "A" * 5000, 1000)


def test_keys_are_opaque_and_metadata_has_sha256(store):
    asset = _capture(store, "p-meta")
    assert asset.storage_key == f"capture/{asset.id}.jpg"
    assert len(asset.sha256) == 64 and asset.size_bytes > 0


# ── signed, expiring links (local folder) ───────────────────────────


def test_signed_link_serves_the_image_then_expires(store, monkeypatch):
    asset = _capture(store, "p-link")
    with SessionLocal() as db:
        url = media.signed_url(db.get(Asset, asset.id), store, ttl_s=60)
    client = TestClient(app)
    r = client.get(url)
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert r.headers["cache-control"] == "private, no-store"
    assert r.content == store.get(asset.storage_key)

    later = time.time() + 61
    monkeypatch.setattr(media.time, "time", lambda: later)
    assert client.get(url).status_code == 403


def test_tampered_or_borrowed_links_are_refused(store):
    mine = _capture(store, "p-owner")
    other = _capture(store, "p-other-owner", color=(200, 10, 10))
    with SessionLocal() as db:
        url = media.signed_url(db.get(Asset, mine.id), store, ttl_s=60)
    q = parse_qs(urlparse(url).query)
    client = TestClient(app)
    assert client.get(f"/v1/media/{other.id}?exp={q['exp'][0]}&sig={q['sig'][0]}").status_code == 403  # another asset
    assert client.get(f"/v1/media/{mine.id}?exp={int(q['exp'][0]) + 999}&sig={q['sig'][0]}").status_code == 403  # longer life
    assert client.get(f"/v1/media/{mine.id}?exp={q['exp'][0]}&sig={'0' * 64}").status_code == 403
    assert client.get(f"/v1/media/{mine.id}").status_code == 403  # no signature at all


def test_links_never_outlive_the_asset(store):
    asset = _capture(store, "p-short", ttl_hours=1)
    with SessionLocal() as db:
        row = db.get(Asset, asset.id)
        row.expires_at = datetime.now(UTC) + timedelta(seconds=20)
        db.commit()
        exp = int(parse_qs(urlparse(media.signed_url(row, store, ttl_s=3600)).query)["exp"][0])
        assert exp <= time.time() + 21
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
        with pytest.raises(media.MediaRejected, match="expired"):
            media.signed_url(row, store)
        delete_profile_data(db, store, "p-short")  # the sweep tests count expired assets globally


def test_other_profiles_cannot_load_an_asset(store):
    asset = _capture(store, "p-alice")
    with SessionLocal() as db, pytest.raises(media.MediaRejected, match="not found"):
        media.load(db, store, asset.id, "p-mallory")


# ── deletion removes the row and the object ─────────────────────────


def test_removing_a_garment_deletes_its_photo(store):
    with SessionLocal() as db:
        photo = media.ingest(db, store, profile_id="p-del", kind="garment", data=jpeg(), ttl_hours=None)
        item = WardrobeItem(profile_id="p-del", category="top", image_asset_id=photo.id, metadata_json={})
        db.add(item)
        db.commit()
        key = photo.storage_key
        wardrobe.remove(db, store, profile_id="p-del", item_id=item.id)
        assert db.get(WardrobeItem, item.id) is None and db.get(Asset, photo.id) is None
    with pytest.raises(FileNotFoundError):
        store.get(key)


def test_delete_all_removes_objects(store):
    asset = _capture(store, "p-wipe-all")
    with SessionLocal() as db:
        delete_profile_data(db, store, "p-wipe-all")
    with pytest.raises(FileNotFoundError):
        store.get(asset.storage_key)


# ── S3 / MinIO ──────────────────────────────────────────────────────


class FakeS3:
    def __init__(self, *, exists=True, policy=None):
        self.exists, self.policy, self.created = exists, policy, False

    def head_bucket(self, Bucket):
        if not self.exists:
            raise ClientError({"Error": {"Code": "404"}}, "HeadBucket")

    def create_bucket(self, Bucket):
        self.created = self.exists = True

    def get_bucket_policy(self, Bucket):
        if self.policy is None:
            raise ClientError({"Error": {"Code": "NoSuchBucketPolicy"}}, "GetBucketPolicy")
        return {"Policy": json.dumps(self.policy)}


def _policy(principal):
    return {"Statement": [{"Effect": "Allow", "Principal": principal, "Action": "s3:GetObject", "Resource": "arn:aws:s3:::b/*"}]}


def test_bucket_is_created_private():
    fake = FakeS3(exists=False)
    S3MediaStore(endpoint="", access_key="", secret_key="", bucket="b", region="us-east-1", client=fake)
    assert fake.created


@pytest.mark.parametrize("principal", ["*", {"AWS": "*"}, {"AWS": ["arn:aws:iam::1:root", "*"]}])
def test_public_buckets_are_refused(principal):
    with pytest.raises(PublicBucketError):
        S3MediaStore(endpoint="", access_key="", secret_key="", bucket="b", region="us-east-1",
                     client=FakeS3(policy=_policy(principal)))


def test_scoped_policies_are_fine():
    S3MediaStore(endpoint="", access_key="", secret_key="", bucket="b", region="us-east-1",
                 client=FakeS3(policy=_policy({"AWS": "arn:aws:iam::1:role/smartmirror"})))


def test_s3_links_are_presigned_and_expire():
    real = boto3.client("s3", endpoint_url="http://minio.local:9000", aws_access_key_id="k", aws_secret_access_key="s",
                        region_name="us-east-1")
    fake = FakeS3()
    fake.generate_presigned_url = real.generate_presigned_url
    s3 = S3MediaStore(endpoint="", access_key="", secret_key="", bucket="b", region="us-east-1", client=fake)
    url = s3.presign("capture/asset_1.jpg", 120)
    q = parse_qs(urlparse(url).query)
    assert url.startswith("http://minio.local:9000/b/capture/asset_1.jpg?")
    assert (q.get("X-Amz-Expires") or q.get("Expires")) and ("X-Amz-Signature" in q or "Signature" in q)
    with pytest.raises(ValueError):
        s3.presign("../secret", 60)


def test_media_link_tool_is_profile_scoped(store):
    asset = _capture(store, "p-tool-link")
    client = TestClient(app)

    def call(profile):
        return client.post("/rpc", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
            "name": "hp.smartmirror.media_link", "arguments": {"profile_id": profile, "asset_id": asset.id, "expires_in": 30}}})

    link = call("p-tool-link").json()["result"]["structuredContent"]
    assert link["expires_in"] == 30 and client.get(link["url"]).status_code == 200
    denied = call("p-someone-else")
    assert denied.status_code == 400 and "RESOURCE_REJECTED" in denied.text
