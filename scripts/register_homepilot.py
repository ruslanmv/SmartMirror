from __future__ import annotations

import os
import sys

import httpx


def main() -> int:
    homepilot = os.getenv("HOMEPILOT_BASE_URL", "http://localhost:8000").rstrip("/")
    api_key = os.getenv("HOMEPILOT_API_KEY", "")
    mcp_url = os.getenv("SMARTMIRROR_PUBLIC_MCP_URL", "http://localhost:8100/rpc")

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "name": "smartmirror",
        "url": mcp_url,
        "transport": "HTTP",
        "description": "SmartMirror wardrobe, styling and virtual try-on MCP tools",
        "tags": ["smartmirror", "wardrobe", "styling"],
        "visibility": "private",
        "auto_refresh": True,
    }

    response = httpx.post(
        f"{homepilot}/v1/agentic/register/gateway",
        headers=headers,
        json=payload,
        timeout=30.0,
    )
    if response.status_code >= 400:
        print(f"HomePilot registration failed: {response.status_code} {response.text}", file=sys.stderr)
        return 1
    print(response.json())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
