"""Select the virtual try-on backend.

Production uses HomePilot (HF web edition at homepilot.ruslanmv.com) via the
edit-session API. OllaBridge Cloud / Grok Imagine is an optional second path
for clothing-swap experiments when garment pixels must go through xAI.
"""

from __future__ import annotations

from services.api.app.config import get_settings

from .base import VirtualTryOnProvider
from .homepilot import HomePilotEditSessionProvider


def get_tryon_provider() -> VirtualTryOnProvider | None:
    s = get_settings()
    name = (s.smartmirror_image_provider or "homepilot").strip().lower()
    if name in ("homepilot", "homepilot-edit-session"):
        return HomePilotEditSessionProvider(s.homepilot_base_url, s.homepilot_api_key)
    if name in ("none", "off", ""):
        return None
    if name in ("ollabridge-cloud", "grok", "grok-imagine"):
        # Optional cloud path — only wired when that provider module is present
        # (later branches). Until then, fail closed so production stays on HomePilot.
        try:
            from .ollabridge_cloud import OllaBridgeCloudEditProvider  # type: ignore
        except ImportError:
            return None
        return OllaBridgeCloudEditProvider(s.ollabridge_base_url, s.ollabridge_token)
    return None


def provider_status() -> dict:
    s = get_settings()
    provider = get_tryon_provider()
    return {
        "image_provider": (s.smartmirror_image_provider or "homepilot").strip().lower(),
        "provider_ready": provider is not None,
        "provider_name": provider.name if provider else None,
        "homepilot_base_url": s.homepilot_base_url,
        "homepilot_api_key_set": bool(s.homepilot_api_key),
        # Live probe is async; /health uses the sync snapshot. See /v1/compute/probe.
        "note": (
            "Production HomePilot try-on needs the edit-session sidecar "
            "(EDIT_SESSION_URL). Without it /v1/edit-sessions returns 503."
        ),
    }
