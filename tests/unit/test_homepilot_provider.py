"""HomePilot is the production try-on backend for the HF Space."""

from __future__ import annotations

import httpx
import pytest

from smartmirror.providers.vton.base import TryOnRequest
from smartmirror.providers.vton.factory import get_tryon_provider, provider_status
from smartmirror.providers.vton.homepilot import (
    HomePilotEditSessionProvider,
    HomePilotProviderError,
)


def test_default_provider_is_homepilot(monkeypatch):
    from services.api.app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("SMARTMIRROR_IMAGE_PROVIDER", "homepilot")
    monkeypatch.setenv("HOMEPILOT_BASE_URL", "https://homepilot.ruslanmv.com")
    get_settings.cache_clear()
    provider = get_tryon_provider()
    assert isinstance(provider, HomePilotEditSessionProvider)
    assert provider.base_url == "https://homepilot.ruslanmv.com"
    status = provider_status()
    assert status["image_provider"] == "homepilot"
    assert status["provider_ready"] is True
    assert "edit-session" in status["note"]
    get_settings.cache_clear()


def test_absolute_url_joins_homepilot_host():
    p = HomePilotEditSessionProvider("https://homepilot.ruslanmv.com", "k")
    assert p._absolute("/media/out.png") == "https://homepilot.ruslanmv.com/media/out.png"
    assert p._absolute("https://cdn.example/x.jpg") == "https://cdn.example/x.jpg"


def test_auth_headers_include_bearer_and_x_api_key():
    p = HomePilotEditSessionProvider("https://homepilot.ruslanmv.com", "secret")
    headers = p._headers()
    assert headers["Authorization"] == "Bearer secret"
    assert headers["X-API-Key"] == "secret"


@pytest.mark.asyncio
async def test_generate_maps_503_to_capability_unavailable():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            503,
            json={
                "ok": False,
                "error": "Edit session service unavailable",
                "code": "edit_session_unavailable",
            },
        )
    )
    p = HomePilotEditSessionProvider(
        "https://homepilot.ruslanmv.com", "k", transport=transport
    )
    with pytest.raises(HomePilotProviderError) as exc:
        await p.generate(
            TryOnRequest(
                person_image=b"\xff\xd8\xff\xd9",
                person_content_type="image/jpeg",
            )
        )
    assert "CAPABILITY_UNAVAILABLE" in str(exc.value)
    assert "edit-session" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_probe_marks_sidecar_missing_on_503():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            503,
            json={"code": "edit_session_unavailable", "detail": "down"},
        )
    )
    p = HomePilotEditSessionProvider(
        "https://homepilot.ruslanmv.com", "k", transport=transport
    )
    probe = await p.probe()
    assert probe["ok"] is False
    assert probe["sidecar_missing"] is True
    assert probe["status"] == 503
