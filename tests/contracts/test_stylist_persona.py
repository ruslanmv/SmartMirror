"""The Stylist persona template is a valid HomePilot .hpersona package."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
import types
import zipfile
from pathlib import Path

import pytest

from integrations.homepilot.personas import build

SOURCE = build.PERSONAS_DIR / "stylist"
PACKAGE = build.package_path(SOURCE)


def _read(name: str) -> dict:
    return json.loads((SOURCE / name).read_text())


def test_required_files_and_manifest():
    for name in build.REQUIRED_FILES:
        assert (SOURCE / name).is_file(), name
    manifest = _read("manifest.json")
    assert manifest["kind"] == "homepilot.persona"
    assert manifest["project_type"] == "persona"
    # HomePilot imports schema 1-3; stay on the widely supported v2.
    assert manifest["schema_version"] == 2
    assert manifest["content_rating"] == "sfw"


def test_persona_is_discoverable_as_stylist():
    agent = _read("blueprint/persona_agent.json")
    # HomePilot derives the model id from the label when no alias is set:
    # "Stylist" -> persona:stylist--<id>, which SmartMirror discovers.
    assert agent["label"] == "Stylist"
    assert agent["category"] == "sfw"
    assert agent["response_style"]["max_length"] == "short"


def test_prompt_keeps_grounding_and_voice_rules():
    prompt = _read("blueprint/persona_agent.json")["system_prompt"]
    assert "Owned items" in prompt
    assert "Never invent clothes" in prompt
    assert "three short sentences" in prompt
    assert "body size" in prompt


def test_no_tool_dependencies_until_the_mirror_tools_ship():
    # HomePilot pins declared tools on import; declaring SmartMirror tools
    # before HomePilot can run them (plan M1b) would break persona chat.
    agent = _read("blueprint/persona_agent.json")
    assert agent["allowed_tools"] == []
    assert not (SOURCE / "dependencies").exists()


def test_committed_package_matches_source():
    assert PACKAGE.is_file(), "run integrations/homepilot/personas/build.py"
    assert PACKAGE.read_bytes() == build.build_package(SOURCE)


def test_package_is_deterministic():
    assert build.build_package(SOURCE) == build.build_package(SOURCE)


def _homepilot_export_import():
    """Load HomePilot's persona importer with its project store stubbed.

    Set HOMEPILOT_SRC to a HomePilot checkout (defaults to ../homepilot next
    to this repo); skipped when unavailable.
    """
    root = Path(os.environ.get("HOMEPILOT_SRC", Path(__file__).resolve().parents[3] / "homepilot"))
    module_path = root / "backend" / "app" / "personas" / "export_import.py"
    if not module_path.is_file():
        pytest.skip("HomePilot checkout not available (set HOMEPILOT_SRC)")

    created: dict = {}
    projects = types.ModuleType("hp_app.projects")

    def create_new_project(data):
        created.update(data)
        return {"id": "proj_stylist_test", **data}

    projects.create_new_project = create_new_project
    projects.update_project = lambda project_id, data: {"id": project_id, **created, **data}

    app_pkg = types.ModuleType("hp_app")
    app_pkg.__path__ = []
    app_pkg.projects = projects
    personas_pkg = types.ModuleType("hp_app.personas")
    personas_pkg.__path__ = []
    name = "hp_app.personas.export_import"
    saved = {k: sys.modules.get(k) for k in ("hp_app", "hp_app.projects", "hp_app.personas", name)}
    sys.modules.update({"hp_app": app_pkg, "hp_app.projects": projects, "hp_app.personas": personas_pkg})
    try:
        spec = importlib.util.spec_from_file_location(name, module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module  # dataclasses resolve their module while executing
        spec.loader.exec_module(module)
    finally:
        for key, value in saved.items():
            if value is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = value
    return module, created


def test_homepilot_preview_and_import_accept_the_package(tmp_path):
    export_import, created = _homepilot_export_import()
    data = PACKAGE.read_bytes()

    preview = export_import.preview_persona_package(data)
    assert preview.persona_agent["label"] == "Stylist"
    assert preview.has_avatar is False

    project = export_import.import_persona_package(tmp_path, data)
    assert created["name"] == "Stylist"
    assert created["project_type"] == "persona"
    assert created["description"].startswith("Smart Mirror stylist")
    assert "tool_ids" not in (created.get("agentic") or {})
    assert project["id"] == "proj_stylist_test"


def test_package_is_a_plain_zip_with_expected_entries():
    names = sorted(zipfile.ZipFile(io.BytesIO(PACKAGE.read_bytes())).namelist())
    assert names == [
        "blueprint/persona_agent.json",
        "blueprint/persona_appearance.json",
        "manifest.json",
        "preview/card.json",
    ]
