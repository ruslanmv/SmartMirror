from __future__ import annotations

import asyncio
import base64
import time

import httpx

from .base import TryOnRequest, TryOnResult, VirtualTryOnProvider


class ProviderError(RuntimeError):
    """Carries a stable code prefix (e.g. CAPABILITY_UNAVAILABLE: …)."""


class HomePilotNodeEditProvider(VirtualTryOnProvider):
    """AI try-on through HomePilot's images.edit node job on the same PC (HP-2).

    POST /v1/node/jobs {operation: "images.edit"} → poll → fetch the output
    artifact. The node endpoints are localhost-only; a Docker sidecar needs
    NODE_MANIFEST_ALLOW_HOSTS on HomePilot. A visual preview, not a fit guarantee.
    """

    name = "homepilot"

    def __init__(self, base_url: str, api_key: str = "", timeout_s: float = 600.0, poll_s: float = 1.5):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout_s = timeout_s
        self.poll_s = poll_s

    def _headers(self) -> dict[str, str]:
        return {"X-API-Key": self.api_key, "Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    async def generate(self, request: TryOnRequest) -> TryOnResult:
        image = f"data:{request.person_content_type};base64," + base64.b64encode(request.person_image).decode()
        body = {"operation": "images.edit", "params": {"prompt": request.instruction, "image": image, "workflow": "edit"}}
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                created = await client.post(f"{self.base_url}/v1/node/jobs", json=body, headers=self._headers())
            except httpx.HTTPError:
                raise ProviderError("CAPABILITY_UNAVAILABLE: HomePilot is not reachable") from None
            if created.status_code in (400, 404):
                raise ProviderError("CAPABILITY_UNAVAILABLE: turn on HOMEPILOT_MIRROR_JOBS_ENABLED and HOMEPILOT_MIRROR_IMAGE_EDIT_ENABLED")
            if created.status_code == 403:
                raise ProviderError("CAPABILITY_UNAVAILABLE: HomePilot refused this host (set NODE_MANIFEST_ALLOW_HOSTS)")
            created.raise_for_status()
            job_id = created.json()["job_id"]

            deadline = time.monotonic() + self.timeout_s
            while True:
                r = await client.get(f"{self.base_url}/v1/node/jobs/{job_id}", headers=self._headers())
                if r.status_code == 404:
                    raise ProviderError("NODE_RESTARTED: HomePilot lost the job (restarted?)")
                r.raise_for_status()
                job = r.json()
                status = job.get("status")
                if status == "completed":
                    break
                if status in ("failed", "cancelled"):
                    # The node marks a job failed a moment before it records the reason.
                    if not job.get("error"):
                        await asyncio.sleep(0.2)
                        job = (await client.get(f"{self.base_url}/v1/node/jobs/{job_id}", headers=self._headers())).json()
                    raise ProviderError(str(job.get("error") or f"IMAGE_EDIT_FAILED: job {status}"))
                if time.monotonic() > deadline:
                    raise ProviderError("JOB_TIMEOUT: HomePilot did not finish the try-on in time")
                await asyncio.sleep(self.poll_s)

            artifacts = (job.get("output") or {}).get("artifacts") or []
            if not artifacts:
                raise ProviderError("IMAGE_EDIT_FAILED: no image produced")
            art = artifacts[0]
            img = await client.get(f"{self.base_url}/v1/node/artifacts/{art['artifact_id']}", headers=self._headers())
            if img.status_code != 200:
                raise ProviderError("IMAGE_EDIT_FAILED: result expired before it was collected")
        return TryOnResult(
            images=[img.content],
            provider=self.name,
            metadata={"node_job_id": job_id, "content_type": art.get("content_type", "image/png")},
        )
