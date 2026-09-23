from __future__ import annotations

from typing import Any

import httpx


class OllaBridgeMirrorClient:
    """Owner-scoped client for OllaBridge Cloud's HomePilot mirror plane."""

    def __init__(self, base_url: str, token: str, timeout: float = 60.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    async def list_nodes(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.get(f"{self.base_url}/v1/mirror/nodes", headers=self._headers())
            r.raise_for_status()
            return r.json()

    async def create_job(self, node_id: str, operation: str, params: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                f"{self.base_url}/v1/mirror/nodes/{node_id}/jobs",
                headers=self._headers(),
                json={"operation": operation, "params": params},
            )
            r.raise_for_status()
            return r.json()

    async def get_job(self, node_id: str, job_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.get(
                f"{self.base_url}/v1/mirror/jobs/{job_id}",
                headers=self._headers(),
                params={"node_id": node_id},
            )
            r.raise_for_status()
            return r.json()

    async def upload_media(self, filename: str, content: bytes, content_type: str) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self.token}"}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                f"{self.base_url}/v1/media/upload",
                headers=headers,
                files={"file": (filename, content, content_type)},
            )
            r.raise_for_status()
            return r.json()
