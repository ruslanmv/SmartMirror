"""HomePilot try-on via the production HF web edition.

Target: https://homepilot.ruslanmv.com
Branch: claude/homepilot-hf-web-edition-410aea

Preferred API: ``/v1/edit-sessions/*`` (proxied to the edit-session sidecar).
As of Nov 2026 that sidecar is not running on production (returns 503). Root
``/chat`` + ``/upload`` are also unreachable from API clients (nginx
``try_files`` returns 405 on POST). Until HomePilot ships the sidecar (or
exposes edit under ``/v1/``), this provider fails closed with a clear error
instead of pretending try-on works.
"""

from __future__ import annotations

import uuid

import httpx

from .base import TryOnRequest, TryOnResult, VirtualTryOnProvider


class HomePilotProviderError(RuntimeError):
    """Terminal try-on failure with a stable code prefix for jobs."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class HomePilotEditSessionProvider(VirtualTryOnProvider):
    """Use HomePilot's edit-session API for a generative style preview.

    This is a visual approximation, not a physical garment-fit simulator.
    Clothing-swap with garment *pixels* is the optional OllaBridge/Grok path.
    """

    name = "homepilot"

    def __init__(
        self,
        base_url: str,
        api_key: str = "",
        timeout: float = 180.0,
        transport: httpx.BaseTransport | httpx.AsyncBaseTransport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self._transport = transport

    def _client(self, timeout: float | None = None) -> httpx.AsyncClient:
        kwargs: dict = {
            "timeout": self.timeout if timeout is None else timeout,
            "follow_redirects": True,
        }
        if self._transport is not None:
            kwargs["transport"] = self._transport
        return httpx.AsyncClient(**kwargs)

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            return {}
        return {
            "Authorization": f"Bearer {self.api_key}",
            "X-API-Key": self.api_key,
        }

    def _absolute(self, url: str) -> str:
        if url.startswith(("http://", "https://")):
            return url
        if url.startswith("/"):
            return f"{self.base_url}{url}"
        return f"{self.base_url}/{url}"

    async def probe(self) -> dict:
        """Cheap check: can we reach edit-sessions (not the SPA shell)?"""
        path = f"{self.base_url}/v1/edit-sessions/smartmirror-probe"
        try:
            async with self._client(timeout=10.0) as client:
                r = await client.get(path, headers=self._headers())
        except httpx.HTTPError as exc:
            return {"ok": False, "status": 0, "detail": str(exc)}
        # 404/401/200 = plane is up. 503 + edit_session_unavailable = sidecar down.
        detail = ""
        code = ""
        try:
            body = r.json()
            detail = str(body.get("detail") or body.get("error") or "")
            code = str(body.get("code") or "")
        except (ValueError, TypeError, httpx.DecodingError):
            detail = (r.text or "")[:200]
        unavailable = r.status_code == 503 or code == "edit_session_unavailable"
        return {
            "ok": not unavailable and r.status_code < 500,
            "status": r.status_code,
            "detail": detail,
            "code": code,
            "sidecar_missing": unavailable,
        }

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

        async with self._client() as client:
            upload = await client.post(
                f"{self.base_url}/v1/edit-sessions/{session_id}/image",
                headers=self._headers(),
                files={"file": ("body.jpg", request.person_image, request.person_content_type)},
            )
            if upload.status_code == 503:
                raise HomePilotProviderError(
                    "CAPABILITY_UNAVAILABLE: HomePilot edit-session sidecar is not running "
                    f"at {self.base_url} (POST /v1/edit-sessions returned 503). "
                    "On production, set EDIT_SESSION_URL to a live sidecar, or temporarily "
                    "use SMARTMIRROR_IMAGE_PROVIDER=ollabridge-cloud for Grok clothing-swap tests. "
                    "Root /chat and /upload are not usable from API clients on the current nginx. "
                    "Local GPU: SMARTMIRROR_IMAGE_PROVIDER=homepilot-node."
                )
            upload.raise_for_status()

            edit = await client.post(
                f"{self.base_url}/v1/edit-sessions/{session_id}/message",
                headers={**self._headers(), "Content-Type": "application/json"},
                json={"message": prompt},
            )
            if edit.status_code == 503:
                raise HomePilotProviderError(
                    "CAPABILITY_UNAVAILABLE: HomePilot edit-session sidecar is not running "
                    f"at {self.base_url}."
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

            images: list[bytes] = []
            for url in urls:
                img = await client.get(url, headers=self._headers())
                img.raise_for_status()
                images.append(img.content)

        if not images:
            raise HomePilotProviderError("IMAGE_EDIT_FAILED: no image produced")

        return TryOnResult(
            image_urls=urls,
            images=images,
            provider=self.name,
            metadata={"session_id": session_id, "homepilot": self.base_url},
        )
