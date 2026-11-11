from __future__ import annotations

import asyncio
import time

import httpx

from .base import ReferenceImage, TryOnRequest, TryOnResult, VirtualTryOnProvider
from .grok_edit import DEFAULT_CLIP_S, cloud_edit_body, cloud_video_body
from .homepilot_node import ProviderError


class OllaBridgeCloudEditProvider(VirtualTryOnProvider):
    """Fallback when no local GPU: OllaBridge Cloud /v1/images/edits (D10).

    The photo leaves the house for this call; it is only used when the owner
    chooses SMARTMIRROR_IMAGE_PROVIDER=ollabridge-cloud. Garment photos are
    sent as ``references`` (and the model becomes ``grok-imagine-image-2.0``)
    only when the caller puts them on the request. The try-on job does that
    when SMARTMIRROR_GROK_IMAGINE is on. A haul clip uses
    ``/v1/videos/generations``. The cloud holds the xAI key and maps this body
    onto Grok; this client never calls api.x.ai itself.
    """

    name = "ollabridge-cloud"

    def __init__(self, base_url: str, token: str, model: str = "edit-default", timeout_s: float = 600.0, poll_s: float = 2.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.model = model
        self.timeout_s = timeout_s
        self.poll_s = poll_s

    async def generate(self, request: TryOnRequest) -> TryOnResult:
        body = cloud_edit_body(
            person=request.person_image,
            person_type=request.person_content_type,
            prompt=request.instruction,
            references=request.references,
            model=self.model,
        )
        return await self._run("/v1/images/edits", body)

    async def generate_clip(
        self,
        request: TryOnRequest,
        garment: ReferenceImage,
        *,
        prompt: str,
        duration: int = DEFAULT_CLIP_S,
    ) -> TryOnResult:
        """One short haul clip of ``garment`` on the person in ``request``."""
        body = cloud_video_body(
            person=request.person_image,
            person_type=request.person_content_type,
            garment=garment,
            prompt=prompt,
            duration=duration,
        )
        return await self._run("/v1/videos/generations", body, artifact_prefix="video/")

    async def _run(self, path: str, body: dict, artifact_prefix: str = "image/") -> TryOnResult:
        if not self.token:
            raise ProviderError("CAPABILITY_UNAVAILABLE: OLLABRIDGE_TOKEN is not set")
        headers = {"Authorization": f"Bearer {self.token}"}
        async with httpx.AsyncClient(base_url=self.base_url, timeout=30.0) as client:
            r = await client.post(path, json=body, headers=headers)
            r.raise_for_status()
            job_id = r.json()["id"]
            job = await self._poll(client, job_id, headers)
            artifacts = (job.get("output") or {}).get("artifacts") or []
            matches = [a for a in artifacts if str(a.get("content_type", "")).startswith(artifact_prefix)]
            if not matches:
                raise ProviderError("IMAGE_EDIT_FAILED: no image produced")
            url = matches[0].get("url", "")
            img = await client.get(url, headers=headers)  # relative URLs resolve against base_url
            img.raise_for_status()
        return TryOnResult(
            images=[img.content],
            provider=self.name,
            metadata={"cloud_job_id": job_id, "model": str(body.get("model", ""))},
        )

    async def _poll(self, client: httpx.AsyncClient, job_id: str, headers: dict[str, str]) -> dict:
        deadline = time.monotonic() + self.timeout_s
        while True:
            j = (await client.get(f"/v1/jobs/{job_id}", headers=headers)).json()
            if j.get("status") == "succeeded":
                return j
            if j.get("status") in ("failed", "canceled"):
                raise ProviderError("IMAGE_EDIT_FAILED: " + str((j.get("error") or {}).get("message", "cloud job failed")))
            if time.monotonic() > deadline:
                raise ProviderError("JOB_TIMEOUT: OllaBridge Cloud did not finish in time")
            await asyncio.sleep(self.poll_s)
