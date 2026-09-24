from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from services.api.app.database import SessionLocal
from services.api.app.main import app
from services.api.app.models import Asset, AuditEvent, CaptureSession, WardrobeItem
from smartmirror.privacy import delete_profile_data, record, sweep_expired
from smartmirror.storage import LocalMediaStore, make_key, set_store, sha256


@pytest.fixture
def store(tmp_path):
    s = LocalMediaStore(tmp_path / "media")
    set_store(s)
    yield s
    set_store(None)


def _asset(db, store, profile, kind, *, expires=None, data=b"img"):
    a = Asset(profile_id=profile, kind=kind, content_type="image/jpeg", size_bytes=len(data), sha256=sha256(data), storage_key="")
    db.add(a)
    db.flush()
    a.storage_key = make_key(kind, a.id, "image/jpeg")
    a.expires_at = expires
    store.put(a.storage_key, data, "image/jpeg")
    return a


def test_local_store_rejects_path_traversal(store):
    with pytest.raises(ValueError):
        store.put("../../etc/passwd", b"x", "image/jpeg")
    with pytest.raises(ValueError):
        make_key("capture", "../x", "image/jpeg")
    key = make_key("capture", "asset_1", "image/png")
    store.put(key, b"png", "image/png")
    assert store.get(key) == b"png"
    store.delete(key)
    store.delete(key)  # idempotent


def test_sweep_removes_only_expired_assets(store):
    now = datetime.now(UTC)
    with SessionLocal() as db:
        old = _asset(db, store, "p-sweep", "capture", expires=now - timedelta(hours=1))
        fresh = _asset(db, store, "p-sweep", "capture", expires=now + timedelta(hours=1))
        keep = _asset(db, store, "p-sweep", "garment", expires=None)
        db.add(CaptureSession(profile_id="p-sweep", expires_at=now - timedelta(minutes=1)))
        db.commit()
        old_key, old_id, fresh_id, keep_id = old.storage_key, old.id, fresh.id, keep.id

        assert sweep_expired(db, store, now) == 1
        assert db.get(Asset, old_id) is None
        assert db.get(Asset, fresh_id) is not None and db.get(Asset, keep_id) is not None
        with pytest.raises(FileNotFoundError):
            store.get(old_key)
        cap = db.query(CaptureSession).filter_by(profile_id="p-sweep").one()
        assert cap.status == "expired"


def test_delete_profile_data_is_scoped_and_leaves_one_event(store):
    with SessionLocal() as db:
        for profile in ("p-wipe", "p-other"):
            db.add(WardrobeItem(profile_id=profile, category="dress", metadata_json={}))
            _asset(db, store, profile, "garment")
            record(db, profile, "wardrobe.item_added")
        db.commit()

        counts = delete_profile_data(db, store, "p-wipe")
        assert counts["wardrobe_items"] == 1 and counts["assets"] == 1
        assert db.query(WardrobeItem).filter_by(profile_id="p-wipe").count() == 0
        assert db.query(WardrobeItem).filter_by(profile_id="p-other").count() == 1
        events = [e.event for e in db.query(AuditEvent).filter_by(profile_id="p-wipe")]
        assert events == ["profile.deleted"]


def test_delete_endpoint_and_tool_require_confirmation(store):
    client = TestClient(app)
    assert client.delete("/v1/profile/data", params={"profile_id": "p-api"}).status_code == 400
    assert client.delete("/v1/profile/data", params={"profile_id": "p-api", "confirm": "DELETE"}).status_code == 200

    def call(arguments):
        return client.post(
            "/rpc",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                  "params": {"name": "hp.smartmirror.profile_delete", "arguments": arguments}},
        )

    assert call({"profile_id": "p-api"}).status_code == 400
    ok = call({"profile_id": "p-api", "confirm": "DELETE"})
    assert ok.status_code == 200
    assert "deleted" in ok.json()["result"]["structuredContent"]


def test_audit_events_never_carry_content(store):
    client = TestClient(app)
    client.post("/rpc", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
        "name": "hp.smartmirror.wardrobe_add",
        "arguments": {"profile_id": "p-audit", "category": "dress", "metadata": {"name": "My secret dress"}}}})
    with SessionLocal() as db:
        events = db.query(AuditEvent).filter_by(profile_id="p-audit").all()
        assert [e.event for e in events] == ["wardrobe.item_added"]
        assert all("secret" not in (e.subject_id or "") for e in events)
