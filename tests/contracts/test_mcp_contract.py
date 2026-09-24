import json
from pathlib import Path

from fastapi.testclient import TestClient

from services.api.app.main import app

CONTRACT = Path(__file__).resolve().parents[2] / "packages" / "contracts" / "smartmirror-mcp-tools.json"


def _list_tools(client: TestClient) -> dict[str, dict]:
    response = client.post("/rpc", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
    assert response.status_code == 200
    return {tool["name"]: tool for tool in response.json()["result"]["tools"]}


def test_mcp_tools_list_contract():
    tools = _list_tools(TestClient(app))
    assert "hp.smartmirror.wardrobe_list" in tools
    assert "hp.smartmirror.style_suggest" in tools
    assert "hp.smartmirror.tryon_create" in tools


def test_mcp_tools_match_shared_contract():
    """The web BFF allow-lists tools from this file, so the server must honour it."""
    tools = _list_tools(TestClient(app))
    contract = json.loads(CONTRACT.read_text())
    for spec in contract["tools"]:
        assert spec["name"] in tools
        assert sorted(tools[spec["name"]]["inputSchema"].get("required", [])) == sorted(spec["required"])


def _call(client: TestClient, name: str, arguments: dict) -> dict:
    response = client.post(
        "/rpc",
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": name, "arguments": arguments}},
    )
    assert response.status_code == 200, response.text
    return response.json()["result"]["structuredContent"]


def test_wardrobe_add_and_job_get_roundtrip():
    with TestClient(app) as client:
        item = _call(client, "hp.smartmirror.wardrobe_add", {"category": "dress", "color": "black"})
        assert item["id"].startswith("garment_")
        suggestion = _call(client, "hp.smartmirror.style_suggest", {"prompt": "black dress"})
        outfit_id = suggestion["outfits"][0]["id"]
        created = _call(
            client,
            "hp.smartmirror.tryon_create",
            {"outfit_id": outfit_id, "body_capture_ref": "capture_test"},
        )
        job = _call(client, "hp.smartmirror.job_get", {"job_id": created["job_id"]})
        assert job["status"] == "queued"
