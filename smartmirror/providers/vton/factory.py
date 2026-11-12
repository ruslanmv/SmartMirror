"""Select the virtual try-on backend.

Production uses HomePilot HF web edition (homepilot.ruslanmv.com) via the
edit-session API. Local single-PC setups can use ``homepilot-node``
(``/v1/node/jobs`` images.edit). OllaBridge Cloud / Grok Imagine is an
optional clothing-swap path when garment pixels must go through xAI.
"""

from __future__ import annotations

from services.api.app.config import get_settings

from .base import VirtualTryOnProvider
from .homepilot import HomePilotEditSessionProvider


def get_tryon_provider() -> VirtualTryOnProvider | None:
    s = get_settings()
    name = (s.smartmirror_image_provider or "homepilot").strip().lower()
    timeout = float(s.smartmirror_tryon_timeout_s)

    if name in ("homepilot", "homepilot-edit-session"):
        return HomePilotEditSessionProvider(
            s.homepilot_base_url,
            s.homepilot_api_key,
            timeout=timeout,
        )
    if name in ("homepilot-node", "homepilot-local"):
        from .homepilot_node import HomePilotNodeEditProvider

        return HomePilotNodeEditProvider(
            s.homepilot_base_url,
            s.homepilot_api_key,
            timeout_s=timeout,
        )
    if name in ("ollabridge-cloud", "grok", "grok-imagine"):
        from .ollabridge_cloud import OllaBridgeCloudEditProvider

        return OllaBridgeCloudEditProvider(
            s.ollabridge_base_url,
            s.ollabridge_token,
            timeout_s=timeout,
        )
    if name in ("none", "off", ""):
        return None
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
        "ollabridge_token_set": bool(s.ollabridge_token),
        "grok_imagine": bool(s.smartmirror_grok_imagine),
        # Live probe is async; /health uses the sync snapshot. See /v1/compute/probe.
        "note": (
            "Production HomePilot try-on needs the edit-session sidecar "
            "(EDIT_SESSION_URL). Without it /v1/edit-sessions returns 503. "
            "Local GPU: SMARTMIRROR_IMAGE_PROVIDER=homepilot-node. "
            "Grok experiments: SMARTMIRROR_IMAGE_PROVIDER=ollabridge-cloud."
        ),
    }
