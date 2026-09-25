from __future__ import annotations

import asyncio
import base64
import time

import httpx

from .base import TryOnRequest, TryOnResult, VirtualTryOnProvider
from .homepilot_node import ProviderError


class OllaBridgeCloudEditProvider(VirtualTryOnProvider):
    """Fallback when no local GPU: OllaBridge Cloud /v1/images/edits (D10).

    The photo leaves the house for this call; it is only used when the owner
    chooses SMARTMIRROR_IMAGE_PROVIDER=ollabridge-cloud.
    """

    name = "ollabridge-cloud"

    def __init__(self, base_url: str, token: str, model: str = "edit-default", timeout_s: float = 600.0, poll_s: float = 2.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.model = model
        self.timeout_s = timeout_s
        self.poll_s = poll_s

    async def generate(self, request: TryOnRequest) -> TryOnResult:
        if not self.token:
            raise ProviderError("CAPABILITY_UNAVAILABLE: OLLABRIDGE_TOKEN is not set")
        headers = {"Authorization": f"Bearer {self.token}"}
        body = {
            "model": self.model,
            "prompt": request.instruction,
            "image": {"b64": base64.b64encode(request.person_image).decode(), "content_type": request.person_content_type},
        }
        async with httpx.AsyncClient(base_url=self.base_url, timeout=30.0) as client:
            r = await client.post("/v1/images/edits", json=body, headers=headers)
            r.raise_for_status()
            job_id = r.json()["id"]
            deadline = time.monotonic() + self.timeout_s
            while True:
                j = (await client.get(f"/v1/jobs/{job_id}", headers=headers)).json()
                if j.get("status") == "succeeded":
                    break
                if j.get("status") in ("failed", "canceled"):
                    raise ProviderError("IMAGE_EDIT_FAILED: " + str((j.get("error") or {}).get("message", "cloud job failed")))
                if time.monotonic() > deadline:
                    raise ProviderError("JOB_TIMEOUT: OllaBridge Cloud did not finish in time")
                await asyncio.sleep(self.poll_s)
            artifacts = (j.get("output") or {}).get("artifacts") or []
            images = [a for a in artifacts if str(a.get("content_type", "")).startswith("image/")]
            if not images:
                raise ProviderError("IMAGE_EDIT_FAILED: no image produced")
            url = images[0].get("url", "")
            img = await client.get(url, headers=headers)  # relative URLs resolve against base_url
            img.raise_for_status()
        return TryOnResult(images=[img.content], provider=self.name, metadata={"cloud_job_id": job_id})
