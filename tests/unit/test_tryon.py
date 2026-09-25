import asyncio
import base64
import io
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from services.api.app.database import SessionLocal
from services.api.app.main import app
from services.api.app.models import Asset, GenerationJob, Outfit, StylingRequest, WardrobeItem
from smartmirror import media
from smartmirror.providers.vton import homepilot_node
from smartmirror.providers.vton.base import TryOnResult, VirtualTryOnProvider
from smartmirror.providers.vton.homepilot_node import HomePilotNodeEditProvider, ProviderError
from smartmirror.storage import LocalMediaStore, set_store
from smartmirror.tryon import service as tryon


def jpeg(w=64, h=48, color=(200, 30, 30), exif=True) -> bytes:
    img = Image.new("RGB", (w, h), color)
    out = io.BytesIO()
    if exif:
        ex = Image.Exif()
        ex[0x010F] = "SecretCam"  # Make
        ex[0x010E] = "lat 51.5 lon -0.1"  # ImageDescription (stands in for location)
        img.save(out, "JPEG", exif=ex.tobytes())
    else:
        img.save(out, "JPEG")
    return out.getvalue()


def data_url(b: bytes, ctype="image/jpeg") -> str:
    return f"data:{ctype};base64," + base64.b64encode(b).decode()


@pytest.fixture
def store(tmp_path):
    s = LocalMediaStore(tmp_path / "media")
    set_store(s)
    yield s
    set_store(None)


def rpc(client, name, arguments):
    r = client.post("/rpc", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                  "params": {"name": name, "arguments": arguments}})
    return r


# ── media ingest ────────────────────────────────────────────────────


def test_normalize_strips_exif_and_caps_size():
    raw = jpeg(3000, 2000)
    assert b"SecretCam" in raw
    clean, ctype = media.normalize_image(raw, max_edge=1600)
    assert ctype == "image/jpeg" and b"SecretCam" not in clean
    assert max(Image.open(io.BytesIO(clean)).size) == 1600


@pytest.mark.parametrize("bad", [b"not an image", b"GIF89a" + b"\x00" * 40])
def test_normalize_rejects_non_images(bad):
    with pytest.raises(media.MediaRejected):
        media.normalize_image(bad)


def test_ingest_dedupes_and_sets_ttl(store):
    with SessionLocal() as db:
        a = media.ingest(db, store, profile_id="p-media", kind="capture", data=jpeg(), ttl_hours=24)
        b = media.ingest(db, store, profile_id="p-media", kind="capture", data=jpeg(), ttl_hours=24)
        assert a.id == b.id
        assert a.expires_at is not None
        data, asset = media.load(db, store, a.id, "p-media")
        assert asset.id == a.id and data[:3] == b"\xff\xd8\xff"
        with pytest.raises(media.MediaRejected):
            media.load(db, store, a.id, "someone-else")


def test_capture_upload_tool(store):
    client = TestClient(app)
    ok = rpc(client, "hp.smartmirror.capture_upload", {"profile_id": "p-cap", "image": data_url(jpeg())})
    assert ok.status_code == 200, ok.text
    out = ok.json()["result"]["structuredContent"]
    assert out["asset_id"].startswith("asset_") and out["expires_at"]
    garment = rpc(client, "hp.smartmirror.capture_upload",
                  {"profile_id": "p-cap", "image": data_url(jpeg(color=(0, 0, 200))), "purpose": "garment"})
    assert garment.json()["result"]["structuredContent"]["expires_at"] is None
    assert rpc(client, "hp.smartmirror.capture_upload", {"image": "http://x/y.jpg"}).status_code == 400
    assert rpc(client, "hp.smartmirror.capture_upload", {"image": data_url(b"zzz")}).status_code == 400


# ── try-on jobs ─────────────────────────────────────────────────────


class FakeProvider(VirtualTryOnProvider):
    name = "fake"

    def __init__(self, result=None, error=None):
        self.result, self.error, self.requests = result, error, []

    async def generate(self, request):
        self.requests.append(request)
        if self.error:
            raise self.error
        return self.result or TryOnResult(images=[jpeg(color=(10, 120, 10), exif=False)], provider=self.name)


def _seed(store, profile="p-try", *, expired=False):
    with SessionLocal() as db:
        dress = WardrobeItem(profile_id=profile, category="dress", color="black", metadata_json={"name": "Black silk slip dress"})
        coat = WardrobeItem(profile_id=profile, category="outerwear", subcategory="coat", color="camel", metadata_json={})
        db.add_all([dress, coat])
        req = StylingRequest(profile_id=profile, prompt="dinner", normalized_intent={})
        db.add(req)
        db.flush()
        outfit = Outfit(styling_request_id=req.id, score=0.9, explanation="", item_ids=[dress.id, coat.id])
        db.add(outfit)
        db.commit()
        capture = media.ingest(db, store, profile_id=profile, kind="capture", data=jpeg(), ttl_hours=24)
        if expired:
            capture.expires_at = datetime.now(UTC) - timedelta(minutes=1)
            db.commit()
        job = tryon.create_tryon_job(db, profile_id=profile, outfit_id=outfit.id, body_capture_ref=capture.id, instruction="evening light")
        return job.id


def test_tryon_succeeds_and_preview_comes_back_small(store):
    job_id = _seed(store)
    fake = FakeProvider()
    assert asyncio.run(tryon.run_tryon_job(job_id, provider=fake, store=store)) == "succeeded"
    (req,) = fake.requests
    assert "Black silk slip dress" in req.instruction and "camel coat" in req.instruction
    assert "evening light" in req.instruction and req.person_content_type == "image/jpeg"

    got = rpc(TestClient(app), "hp.smartmirror.job_get", {"job_id": job_id}).json()["result"]["structuredContent"]
    assert got["status"] == "succeeded"
    assert got["result"]["disclaimer"] == tryon.DISCLAIMER
    assert got["result"]["preview_url"].startswith("data:image/jpeg;base64,")
    with SessionLocal() as db:
        preview = db.get(Asset, got["result"]["preview_asset_id"])
        assert preview.kind == "preview" and preview.expires_at is not None


@pytest.mark.parametrize(
    "setup,code",
    [
        ("expired_capture", "RESOURCE_REJECTED"),
        ("provider_error", "CAPABILITY_UNAVAILABLE"),
        ("provider_crash", "IMAGE_EDIT_FAILED"),
    ],
)
def test_tryon_failures_keep_a_code(store, setup, code):
    job_id = _seed(store, profile=f"p-{setup}", expired=setup == "expired_capture")
    provider = {
        "expired_capture": FakeProvider(),
        "provider_error": FakeProvider(error=ProviderError("CAPABILITY_UNAVAILABLE: turn it on")),
        "provider_crash": FakeProvider(error=RuntimeError("boom")),
    }[setup]
    assert asyncio.run(tryon.run_tryon_job(job_id, provider=provider, store=store)) == "failed"
    with SessionLocal() as db:
        assert db.get(GenerationJob, job_id).error_code.startswith(code)


def test_unknown_outfit_fails(store):
    with SessionLocal() as db:
        cap = media.ingest(db, store, profile_id="p-no-outfit", kind="capture", data=jpeg(), ttl_hours=1)
        job = tryon.create_tryon_job(db, profile_id="p-no-outfit", outfit_id="outfit_x", body_capture_ref=cap.id, instruction="")
    asyncio.run(tryon.run_tryon_job(job.id, provider=FakeProvider(), store=store))
    with SessionLocal() as db:
        assert db.get(GenerationJob, job.id).error_code == "RESOURCE_REJECTED: outfit not found"


def test_stale_running_jobs_are_failed_by_the_worker(store):
    with SessionLocal() as db:
        job = GenerationJob(profile_id="p-stale", job_type="tryon", status="running", request_json={},
                            created_at=datetime.now(UTC) - timedelta(hours=1))
        db.add(job)
        db.commit()
        job_id = job.id
    asyncio.run(tryon.process_queued())
    with SessionLocal() as db:
        assert db.get(GenerationJob, job_id).error_code.startswith("NODE_RESTARTED")


# ── HomePilot images.edit provider ──────────────────────────────────


def _mock(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(homepilot_node.httpx, "AsyncClient", lambda *a, **k: real(*a, **{**k, "transport": httpx.MockTransport(handler)}))


def test_homepilot_provider_runs_images_edit(monkeypatch):
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 20
    polls = []

    def handler(request):
        if request.method == "POST" and request.url.path == "/v1/node/jobs":
            body = json.loads(request.content)
            assert body["operation"] == "images.edit"
            assert body["params"]["image"].startswith("data:image/jpeg;base64,")
            assert request.headers["x-api-key"] == "k"
            return httpx.Response(202, json={"job_id": "job_1", "status": "queued"})
        if request.url.path == "/v1/node/jobs/job_1":
            polls.append(1)
            if len(polls) == 1:
                return httpx.Response(200, json={"status": "running"})
            return httpx.Response(200, json={"status": "completed", "output": {"artifacts": [{"artifact_id": "art_abc", "content_type": "image/png"}]}})
        if request.url.path == "/v1/node/artifacts/art_abc":
            return httpx.Response(200, content=png)
        return httpx.Response(404)

    _mock(monkeypatch, handler)
    from smartmirror.providers.vton.base import TryOnRequest

    result = asyncio.run(HomePilotNodeEditProvider("http://hp", "k", poll_s=0).generate(
        TryOnRequest(person_image=jpeg(), person_content_type="image/jpeg", instruction="x")))
    assert result.images == [png] and result.provider == "homepilot"


@pytest.mark.parametrize(
    "responses,code",
    [
        ({"create": 404}, "CAPABILITY_UNAVAILABLE"),
        ({"create": 403}, "CAPABILITY_UNAVAILABLE"),
        ({"poll": 404}, "NODE_RESTARTED"),
        ({"poll_failed": "RuntimeError: IMAGE_EDIT_FAILED: the edit produced no image"}, "IMAGE_EDIT_FAILED"),
    ],
)
def test_homepilot_provider_errors(monkeypatch, responses, code):
    def handler(request):
        if request.method == "POST":
            status = responses.get("create", 202)
            return httpx.Response(status, json={"job_id": "job_1"} if status == 202 else {"error": "x"})
        if "poll" in responses:
            return httpx.Response(404, json={"error": "job_not_found"})
        return httpx.Response(200, json={"status": "failed", "error": responses["poll_failed"]})

    _mock(monkeypatch, handler)
    from smartmirror.providers.vton.base import TryOnRequest

    with pytest.raises(ProviderError, match=code):
        asyncio.run(HomePilotNodeEditProvider("http://hp", poll_s=0).generate(
            TryOnRequest(person_image=jpeg(), person_content_type="image/jpeg", instruction="x")))


# ── phone → screen capture sessions ────────────────────────────────


def test_capture_session_round_trip(store):
    client = TestClient(app)
    call = lambda name, args: rpc(client, name, {"profile_id": "p-hand", **args})
    sid = call("hp.smartmirror.capture_session_create", {}).json()["result"]["structuredContent"]["session_id"]
    waiting = call("hp.smartmirror.capture_session_get", {"session_id": sid}).json()["result"]["structuredContent"]
    assert waiting["status"] == "waiting" and "preview_url" not in waiting

    asset = call("hp.smartmirror.capture_upload", {"image": data_url(jpeg())}).json()["result"]["structuredContent"]
    done = call("hp.smartmirror.capture_session_complete", {"session_id": sid, "asset_id": asset["asset_id"]})
    assert done.json()["result"]["structuredContent"]["status"] == "received"
    got = call("hp.smartmirror.capture_session_get", {"session_id": sid}).json()["result"]["structuredContent"]
    assert got["status"] == "received" and got["asset_id"] == asset["asset_id"]
    assert got["preview_url"].startswith("data:image/jpeg;base64,")
    # completing twice or from another profile is refused
    assert call("hp.smartmirror.capture_session_complete", {"session_id": sid, "asset_id": asset["asset_id"]}).status_code == 400
    assert rpc(client, "hp.smartmirror.capture_session_get", {"profile_id": "intruder", "session_id": sid}).status_code == 400


def test_capture_session_expires(store):
    from services.api.app.models import CaptureSession

    with SessionLocal() as db:
        cap = CaptureSession(profile_id="p-exp", expires_at=datetime.now(UTC) - timedelta(seconds=1))
        db.add(cap)
        db.commit()
        sid = cap.id
    got = rpc(TestClient(app), "hp.smartmirror.capture_session_get", {"profile_id": "p-exp", "session_id": sid})
    assert got.json()["result"]["structuredContent"]["status"] == "expired"
