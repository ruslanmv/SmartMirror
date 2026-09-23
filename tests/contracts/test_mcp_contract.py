from fastapi.testclient import TestClient

from services.api.app.main import app


def test_mcp_tools_list_contract():
    client = TestClient(app)
    response = client.post("/rpc", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
    assert response.status_code == 200
    body = response.json()
    names = {tool["name"] for tool in body["result"]["tools"]}
    assert "hp.smartmirror.wardrobe_list" in names
    assert "hp.smartmirror.style_suggest" in names
    assert "hp.smartmirror.tryon_create" in names
