from __future__ import annotations

import uuid

import httpx

from .base import TryOnRequest, TryOnResult, VirtualTryOnProvider


class HomePilotEditSessionProvider(VirtualTryOnProvider):
    """Use HomePilot's existing edit-session API for a generative style preview.

    This is a visual approximation provider, not a physical garment-fit simulator.
    """

    name = "homepilot-edit-session"

    def __init__(self, base_url: str, api_key: str = "", timeout: float = 180.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    async def generate(self, request: TryOnRequest) -> TryOnResult:
        session_id = "smartmirror-" + uuid.uuid4().hex
        prompt = request.instruction.strip() or "Change only the clothing while preserving identity, face, hair, body proportions, pose, camera perspective, and background."
        if request.garment_refs:
            prompt += " Use the supplied SmartMirror wardrobe references: " + ", ".join(request.garment_refs)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
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
                        urls.append(item)
                    elif isinstance(item, dict) and item.get("url"):
                        urls.append(str(item["url"]))
        if not urls and isinstance(data.get("active_image_url"), str):
            urls.append(data["active_image_url"])

        return TryOnResult(image_urls=urls, provider=self.name, metadata={"session_id": session_id, "raw": data})
