import logging

import pytest
from fastapi.testclient import TestClient

from services.api.app.main import app
from smartmirror import hardening


def call(client, name, args):
    return client.post("/rpc", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}})


@pytest.fixture
def client():
    return TestClient(app)


ITEM = {"profile_id": "p-hard", "category": "top", "color": "white"}


def test_same_idempotency_key_creates_once(client):
    meta = {"_meta": {"idempotency_key": "k-1", "trace_id": "t-1"}}
    first = call(client, "hp.smartmirror.wardrobe_add", {**ITEM, **meta}).json()["result"]
    again = call(client, "hp.smartmirror.wardrobe_add", {**ITEM, **meta}).json()["result"]
    assert first["structuredContent"]["id"] == again["structuredContent"]["id"]
    other = call(client, "hp.smartmirror.wardrobe_add", {**ITEM, "_meta": {"idempotency_key": "k-2"}}).json()["result"]
    assert other["structuredContent"]["id"] != first["structuredContent"]["id"]
    listed = call(client, "hp.smartmirror.wardrobe_list", {"profile_id": "p-hard"}).json()["result"]["structuredContent"]
    assert len(listed) == 2


def test_meta_never_reaches_handlers_and_trace_is_echoed(client, caplog):
    caplog.set_level(logging.INFO, logger="smartmirror.tools")
    r = call(client, "hp.smartmirror.wardrobe_add", {**ITEM, "_meta": {"trace_id": "trace-abc"}}).json()["result"]
    assert "_meta" not in r["structuredContent"].get("metadata", {})
    assert r["_meta"] == {"trace_id": "trace-abc"}
    assert "tool=hp.smartmirror.wardrobe_add trace=trace-abc ok=true" in caplog.text

    err = call(client, "hp.smartmirror.set_delete", {"profile_id": "p-hard", "set_id": "nope", "_meta": {"trace_id": "trace-err"}}).json()
    assert err["error"]["data"] == {"trace_id": "trace-err"}


def test_unsafe_meta_values_are_ignored():
    args, trace, key = hardening.split_meta({"a": 1, "_meta": {"trace_id": "x" * 65, "idempotency_key": "bad key!"}})
    assert args == {"a": 1} and trace is None and key is None
    assert hardening.split_meta({"_meta": "nope"})[1:] == (None, None)


def test_rate_limit_per_profile(client, monkeypatch):
    monkeypatch.setitem(hardening.RATE_LIMITS, "hp.smartmirror.wardrobe_add", 2)
    for _ in range(2):
        assert call(client, "hp.smartmirror.wardrobe_add", ITEM).status_code == 200
    r = call(client, "hp.smartmirror.wardrobe_add", ITEM)
    assert r.status_code == 429 and "RATE_LIMITED" in r.text
    # another profile is unaffected; a replayed idempotent call does not count
    assert call(client, "hp.smartmirror.wardrobe_add", {**ITEM, "profile_id": "p-hard-2"}).status_code == 200
