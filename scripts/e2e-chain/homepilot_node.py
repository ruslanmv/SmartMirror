"""HomePilot's REAL node-jobs router (agentic.invoke + images.edit), with two
stand-ins: Context Forge is a shim that forwards tools/call to SmartMirror's
MCP endpoint, and the ComfyUI render inverts the input image.

Needs a HomePilot checkout at $HOMEPILOT_DIR (branch with HP-1/HP-2).
"""
import os
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

WORK = os.environ.get("E2E_WORK", "/tmp/smartmirror-e2e")
SMARTMIRROR_RPC = os.environ.get("SMARTMIRROR_RPC", "http://127.0.0.1:8100/rpc")
sys.path.insert(0, os.path.join(os.environ["HOMEPILOT_DIR"], "backend"))
os.environ.update({
    "HOMEPILOT_MIRROR_JOBS_ENABLED": "true",
    "HOMEPILOT_MIRROR_MCP_ENABLED": "true",
    # profile_delete is deliberately left out: the suites check the denial.
    "HOMEPILOT_MIRROR_ALLOWED_TOOLS": os.environ.get(
        "ALLOWED",
        "hp.smartmirror.wardrobe_*,hp.smartmirror.style_suggest,hp.smartmirror.tryon_create,hp.smartmirror.job_get,"
        "hp.smartmirror.capture_*,hp.smartmirror.set_*,hp.smartmirror.shop_*",
    ),
    "NODE_ARTIFACTS_DIR": f"{WORK}/artifacts",
    "HOMEPILOT_MIRROR_IMAGE_EDIT_ENABLED": "true",
    "UPLOAD_DIR": f"{WORK}/uploads",
})

import app.node_ops_agentic as ops
import app.node_ops_images_edit as edit_ops
import httpx
from app.node_jobs import router
from fastapi import FastAPI
from PIL import Image, ImageOps


class ForgeShim:
    async def list_tools(self, timeout=5.0):
        return []

    async def invoke_tool(self, tool_id, args, timeout=30.0):
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.post(SMARTMIRROR_RPC, json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                                    "params": {"name": tool_id, "arguments": args}})
            return r.json()


async def fake_render(prompt, image_ref, model, workflow):
    root = Path(os.environ["UPLOAD_DIR"])
    src = Image.open(root / image_ref.replace("/files/", "")).convert("RGB")
    out = root / "outputs" / f"{uuid.uuid4().hex}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    ImageOps.invert(src).save(out, "PNG")
    return SimpleNamespace(images=[f"/files/outputs/{out.name}"], meta={"provider": "fake-comfy"})


ops._forge_client = lambda: ForgeShim()
edit_ops._edit = fake_render
app = FastAPI()
app.include_router(router)
