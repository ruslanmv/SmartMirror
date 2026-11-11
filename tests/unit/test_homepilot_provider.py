"""HomePilot is the production try-on backend for the HF Space."""

from __future__ import annotations

from smartmirror.providers.vton.factory import get_tryon_provider, provider_status
from smartmirror.providers.vton.homepilot import HomePilotEditSessionProvider


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
