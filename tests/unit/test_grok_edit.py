"""Grok Imagine request shapes sent through OllaBridge Cloud."""

import asyncio
import base64
import json

import httpx
import pytest

from services.api.app.config import get_settings
from services.api.app.database import SessionLocal
from services.api.app.models import GenerationJob, Outfit, StylingRequest, WardrobeItem
from smartmirror import media
from smartmirror.providers.vton import ollabridge_cloud
from smartmirror.providers.vton.base import ReferenceImage, TryOnRequest
from smartmirror.providers.vton.grok_edit import (
    GROK_IMAGE_MODEL,
    GROK_VIDEO_MODEL,
    HaulFrame,
    cloud_edit_body,
    cloud_video_body,
    haul_clip_prompt,
    haul_edit_bodies,
    swap_prompt,
)
from smartmirror.providers.vton.homepilot_node import ProviderError
from smartmirror.providers.vton.ollabridge_cloud import OllaBridgeCloudEditProvider
from smartmirror.storage import LocalMediaStore, set_store
from smartmirror.tryon import service as tryon
from tests.unit.test_tryon import jpeg


@pytest.fixture
def store(tmp_path):
    media_store = LocalMediaStore(tmp_path / "media")
    set_store(media_store)
    yield media_store
    set_store(None)


def _ref(label: str, color=(10, 20, 30)) -> ReferenceImage:
    return ReferenceImage(
        data=jpeg(color=color, exif=False), content_type="image/jpeg", label=label
    )


def test_text_only_edit_stays_on_the_legacy_model():
    body = cloud_edit_body(
        person=jpeg(exif=False),
        person_type="image/jpeg",
        prompt="dress them in a black coat",
    )
    assert body["model"] == "edit-default"
    assert "references" not in body
    assert base64.b64decode(body["image"]["b64"])


def test_garment_pixels_select_grok_and_keep_image_order():
    dress = _ref("Black silk slip dress")
    body = cloud_edit_body(
        person=jpeg(color=(1, 2, 3), exif=False),
        person_type="image/jpeg",
        prompt=swap_prompt([dress]),
        references=[dress],
    )
    assert body["model"] == GROK_IMAGE_MODEL
    assert len(body["references"]) == 1
    assert body["references"][0]["content_type"] == "image/jpeg"
    assert "image 2 (Black silk slip dress)" in body["prompt"]
    assert "Image 1 is a real person" in body["prompt"]
    # The person is not the garment.
    assert body["image"]["b64"] != body["references"][0]["b64"]


def test_fifth_garment_is_rejected():
    with pytest.raises(ProviderError, match="at most 4"):
        cloud_edit_body(
            person=jpeg(exif=False),
            person_type="image/jpeg",
            prompt="x",
            references=[_ref(f"piece {i}") for i in range(5)],
        )


def test_haul_is_one_still_per_garment_on_the_original_photo():
    person = jpeg(color=(9, 9, 9), exif=False)
    frames = [
        HaulFrame(_ref("navy blazer", (1, 1, 40)), slot="jacket"),
        HaulFrame(_ref("white shirt", (240, 240, 240)), slot="top"),
        HaulFrame(_ref("black trousers", (0, 0, 0)), slot="trousers"),
    ]
    bodies = haul_edit_bodies(person=person, person_type="image/jpeg", frames=frames)
    assert len(bodies) == 3
    person_b64 = bodies[0]["image"]["b64"]
    assert base64.b64decode(person_b64) == person
    for body, frame in zip(bodies, frames, strict=True):
        assert body["model"] == GROK_IMAGE_MODEL
        assert body["image"]["b64"] == person_b64
        assert len(body["references"]) == 1
        assert frame.garment.label in body["prompt"]
        assert f"Replace only the {frame.slot}" in body["prompt"]
    # Frames are not chained: each reference is that garment, not a previous result.
    assert bodies[0]["references"][0]["b64"] != bodies[1]["references"][0]["b64"]


def test_haul_bounds():
    person = jpeg(exif=False)
    with pytest.raises(ProviderError, match="at least one"):
        haul_edit_bodies(person=person, person_type="image/jpeg", frames=[])
    with pytest.raises(ProviderError, match="at most 8"):
        haul_edit_bodies(
            person=person,
            person_type="image/jpeg",
            frames=[HaulFrame(_ref(f"item {i}")) for i in range(9)],
        )


def test_haul_clip_body_is_one_person_and_one_garment():
    garment = _ref("red dress")
    body = cloud_video_body(
        person=jpeg(exif=False),
        person_type="image/jpeg",
        garment=garment,
        prompt=haul_clip_prompt("red dress", slot="dress"),
        duration=6,
    )
    assert body["model"] == GROK_VIDEO_MODEL
    assert body["duration"] == 6
    assert len(body["references"]) == 1
    assert "image 2" in body["prompt"] and "dress" in body["prompt"]
    with pytest.raises(ProviderError, match="2 to 10"):
        cloud_video_body(
            person=jpeg(exif=False),
            person_type="image/jpeg",
            garment=garment,
            prompt="x",
            duration=15,
        )


def test_rejects_non_images():
    with pytest.raises(ProviderError, match="JPEG, PNG or WebP"):
        cloud_edit_body(person=b"not", person_type="image/gif", prompt="x")


def _mock(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(
        ollabridge_cloud.httpx,
        "AsyncClient",
        lambda *a, **k: real(*a, **{**k, "transport": httpx.MockTransport(handler)}),
    )


def test_provider_posts_references_and_polls_the_cloud_job(monkeypatch):
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 16
    seen = {}

    def handler(request):
        if request.method == "POST" and request.url.path == "/v1/images/edits":
            seen["body"] = json.loads(request.content)
            assert request.headers["authorization"] == "Bearer tok"
            return httpx.Response(202, json={"id": "cloud_1"})
        if request.url.path == "/v1/jobs/cloud_1":
            return httpx.Response(
                200,
                json={
                    "status": "succeeded",
                    "output": {
                        "artifacts": [{"url": "/v1/media/out.png", "content_type": "image/png"}]
                    },
                },
            )
        if request.url.path == "/v1/media/out.png":
            return httpx.Response(200, content=png)
        return httpx.Response(404)

    _mock(monkeypatch, handler)
    dress = _ref("linen shirt")
    result = asyncio.run(
        OllaBridgeCloudEditProvider("https://cloud.example", "tok", poll_s=0).generate(
            TryOnRequest(
                person_image=jpeg(exif=False),
                person_content_type="image/jpeg",
                instruction=swap_prompt([dress]),
                references=[dress],
            )
        )
    )
    assert result.images == [png]
    assert result.metadata["model"] == GROK_IMAGE_MODEL
    assert seen["body"]["model"] == GROK_IMAGE_MODEL
    assert len(seen["body"]["references"]) == 1


def test_provider_posts_a_haul_clip(monkeypatch):
    mp4 = b"\x00\x00\x00\x18ftypmp42" + b"0" * 8

    def handler(request):
        if request.method == "POST" and request.url.path == "/v1/videos/generations":
            body = json.loads(request.content)
            assert body["model"] == GROK_VIDEO_MODEL and body["duration"] == 6
            return httpx.Response(202, json={"id": "vid_1"})
        if request.url.path == "/v1/jobs/vid_1":
            return httpx.Response(
                200,
                json={
                    "status": "succeeded",
                    "output": {
                        "artifacts": [{"url": "/v1/media/out.mp4", "content_type": "video/mp4"}]
                    },
                },
            )
        if request.url.path == "/v1/media/out.mp4":
            return httpx.Response(200, content=mp4)
        return httpx.Response(404)

    _mock(monkeypatch, handler)
    garment = _ref("red dress")
    result = asyncio.run(
        OllaBridgeCloudEditProvider("https://cloud.example", "tok", poll_s=0).generate_clip(
            TryOnRequest(person_image=jpeg(exif=False), person_content_type="image/jpeg"),
            garment,
            prompt=haul_clip_prompt(garment.label, slot="dress"),
        )
    )
    assert result.images == [mp4]


def _seed_cloud_job(store, profile="p-grok"):
    with SessionLocal() as db:
        photo = media.ingest(
            db,
            store,
            profile_id=profile,
            kind="garment",
            data=jpeg(color=(4, 5, 6)),
            ttl_hours=None,
        )
        dress = WardrobeItem(
            profile_id=profile,
            category="dress",
            color="black",
            metadata_json={"name": "Black silk slip dress"},
            image_asset_id=photo.id,
        )
        coat = WardrobeItem(
            profile_id=profile,
            category="outerwear",
            color="camel",
            metadata_json={"name": "Camel coat"},
        )
        db.add_all([dress, coat])
        req = StylingRequest(profile_id=profile, prompt="dinner", normalized_intent={})
        db.add(req)
        db.flush()
        outfit = Outfit(
            styling_request_id=req.id, score=0.9, explanation="", item_ids=[dress.id, coat.id]
        )
        db.add(outfit)
        db.commit()
        capture = media.ingest(db, store, profile_id=profile, kind="capture", data=jpeg(), ttl_hours=24)
        job = tryon.create_tryon_job(
            db,
            profile_id=profile,
            outfit_id=outfit.id,
            body_capture_ref=capture.id,
            instruction="evening light",
        )
        return job.id, photo.storage_key


class _CloudFake:
    name = "ollabridge-cloud"

    def __init__(self):
        self.requests = []

    async def generate(self, request):
        self.requests.append(request)
        from smartmirror.providers.vton.base import TryOnResult

        return TryOnResult(images=[jpeg(color=(10, 120, 10), exif=False)], provider=self.name)


def test_cloud_tryon_attaches_wardrobe_photos(store, monkeypatch):
    """A cloud try-on sends the garment file once Grok is explicitly on."""
    monkeypatch.setattr(get_settings(), "smartmirror_grok_imagine", True)
    job_id, _key = _seed_cloud_job(store)

    fake = _CloudFake()
    assert asyncio.run(tryon.run_tryon_job(job_id, provider=fake, store=store)) == "succeeded"
    (sent,) = fake.requests
    assert len(sent.references) == 1
    assert sent.references[0].label == "Black silk slip dress"
    assert "image 2 (Black silk slip dress)" in sent.instruction
    assert "Camel coat" in sent.instruction
    assert "evening light" in sent.instruction


def test_cloud_tryon_stays_text_only_until_grok_is_enabled(store):
    job_id, _key = _seed_cloud_job(store, profile="p-legacy")
    fake = _CloudFake()
    assert asyncio.run(tryon.run_tryon_job(job_id, provider=fake, store=store)) == "succeeded"
    (sent,) = fake.requests
    assert sent.references == []
    assert "image 2" not in sent.instruction
    assert "Black silk slip dress" in sent.instruction
    body = cloud_edit_body(
        person=sent.person_image,
        person_type=sent.person_content_type,
        prompt=sent.instruction,
        references=sent.references,
    )
    assert body["model"] == "edit-default"
    assert "references" not in body


def test_missing_garment_file_falls_back_to_words(store, monkeypatch):
    monkeypatch.setattr(get_settings(), "smartmirror_grok_imagine", True)
    job_id, key = _seed_cloud_job(store, profile="p-missing")
    (store.root / key).unlink()
    fake = _CloudFake()
    assert asyncio.run(tryon.run_tryon_job(job_id, provider=fake, store=store)) == "succeeded"
    (sent,) = fake.requests
    assert sent.references == []
    assert "Black silk slip dress" in sent.instruction
    with SessionLocal() as db:
        assert db.get(GenerationJob, job_id).status == "succeeded"


def test_garment_storage_error_fails_the_job(store, monkeypatch):
    monkeypatch.setattr(get_settings(), "smartmirror_grok_imagine", True)
    job_id, _key = _seed_cloud_job(store, profile="p-disk")

    class DiskError(store.__class__):
        def get(self, key):
            if key.startswith("garment/"):
                raise OSError("disk failure")
            return super().get(key)

    broken = DiskError(store.root)
    fake = _CloudFake()
    assert asyncio.run(tryon.run_tryon_job(job_id, provider=fake, store=broken)) == "failed"
    assert fake.requests == []
    with SessionLocal() as db:
        job = db.get(GenerationJob, job_id)
        assert job.status == "failed"
        assert job.error_code.startswith("RESOURCE_REJECTED")
