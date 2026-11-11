from __future__ import annotations

import uuid

import httpx

from .base import TryOnRequest, TryOnResult, VirtualTryOnProvider


class HomePilotEditSessionProvider(VirtualTryOnProvider):
    """Use HomePilot's edit-session API for a generative style preview.

    Production target is the HF web edition at https://homepilot.ruslanmv.com
    (branch ``claude/homepilot-hf-web-edition-410aea``). This is a visual
    approximation, not a physical garment-fit simulator. Clothing-swap with
    garment *pixels* is the optional OllaBridge/Grok path, not this provider.
    """

    name = "homepilot-edit-session"

    def __init__(self, base_url: str, api_key: str = "", timeout: float = 180.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            return {}
        # HomePilot accepts Bearer or X-API-Key for the shared API_KEY.
        return {
            "Authorization": f"Bearer {self.api_key}",
            "X-API-Key": self.api_key,
        }

    def _absolute(self, url: str) -> str:
        if url.startswith("http://") or url.startswith("https://"):
            return url
        if url.startswith("/"):
            return f"{self.base_url}{url}"
        return f"{self.base_url}/{url}"

    async def generate(self, request: TryOnRequest) -> TryOnResult:
        session_id = "smartmirror-" + uuid.uuid4().hex
        prompt = request.instruction.strip() or (
            "Change only the clothing while preserving identity, face, hair, "
            "body proportions, pose, camera perspective, and background."
        )
        if request.garment_refs:
            prompt += " Use the supplied SmartMirror wardrobe references: " + ", ".join(
                request.garment_refs
            )

        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
            upload = await client.post(
                f"{self.base_url}/v1/edit-sessions/{session_id}/image",
                headers=self._headers(),
                files={"file": ("body.jpg", request.person_image, request.person_content_type)},
            )
            upload.raise_for_status()

            edit = await client.post(
                f"{self.base_url}/v1/edit-sessions/{session_id}/message",
                headers={**self._headers(), "Content-Type": "application/json"},
                json={"message": prompt},
            )
            edit.raise_for_status()
            data = edit.json()

        urls: list[str] = []
        for key in ("images", "image_urls", "results", "urls"):
            value = data.get(key)
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, str):
                        urls.append(self._absolute(item))
                    elif isinstance(item, dict) and item.get("url"):
                        urls.append(self._absolute(str(item["url"])))
        if not urls and isinstance(data.get("active_image_url"), str):
            urls.append(self._absolute(data["active_image_url"]))

        return TryOnResult(
            image_urls=urls,
            provider=self.name,
            metadata={"session_id": session_id, "homepilot": self.base_url},
        )
