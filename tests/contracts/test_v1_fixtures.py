"""Shared v1 fixtures stay consistent with the SmartMirror tool contract and,
when a checkout is available, with HomePilot's agentic.invoke implementation."""
import fnmatch
import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
V1 = ROOT / "packages" / "contracts" / "v1"
TOOLS = {t["name"] for t in json.loads((ROOT / "packages/contracts/smartmirror-mcp-tools.json").read_text())["tools"]}


def load(name):
    return json.loads((V1 / name).read_text())


def test_fixtures_are_valid_json():
    for path in V1.glob("*.json"):
        json.loads(path.read_text())


def test_invoke_fixtures_use_published_tools_and_the_documented_allow_list():
    req = load("agentic-invoke.request.json")
    assert req["operation"] == "agentic.invoke"
    assert req["params"]["tool"] in TOOLS
    assert all(fnmatch.fnmatchcase(t, "hp.smartmirror.*") for t in TOOLS)
    done = load("agentic-invoke.completed.json")
    assert done["status"] == "completed" and done["output"]["tool"] in TOOLS
    failed = load("agentic-invoke.failed.json")
    codes = load("errors.json")["codes"]
    assert any(code in failed["error"] for code in codes)


def test_images_edit_fixture_uses_media_refs():
    req = load("images-edit.request.json")
    assert req["operation"] == "images.edit"
    assert req["resource_uri"].startswith("ollabridge-media://")


def _homepilot_ops():
    root = Path(os.environ.get("HOMEPILOT_SRC", ROOT.parent / "homepilot"))
    path = root / "backend" / "app" / "node_ops_agentic.py"
    if not path.is_file():
        pytest.skip("HomePilot checkout with agentic.invoke not available (set HOMEPILOT_SRC)")
    spec = importlib.util.spec_from_file_location("hp_node_ops_agentic", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod, path.read_text()


def test_homepilot_agentic_invoke_matches_the_fixtures():
    ops, source = _homepilot_ops()
    assert ops.OPERATION == load("agentic-invoke.request.json")["operation"]
    for code in ("TOOL_NOT_ALLOWED", "CAPABILITY_UNAVAILABLE", "TOOL_FAILED"):
        assert code in source and code in load("errors.json")["codes"]
    raw = {"jsonrpc": "2.0", "id": 1, "result": {"structuredContent": load("agentic-invoke.completed.json")["output"]["result"]}}
    assert ops.normalize_result(raw) == load("agentic-invoke.completed.json")["output"]["result"]
