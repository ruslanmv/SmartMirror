"""Stand-in for OllaBridge Cloud: pairing, node list and the mirror plane.
The relay hop runs OllaBridge Local's REAL homepilot_mirror_relay.dispatch
against HomePilot, so everything past the cloud is real code.

Needs an OllaBridge checkout at $OLLABRIDGE_DIR (branch with OL-1).
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.environ["OLLABRIDGE_DIR"], "src"))

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from ollabridge.cloud import homepilot_mirror_relay as relay

TOKEN = "tok_CHAIN_SECRET"
PAIR_CODE = "ABCD1234"
HP = os.environ.get("HOMEPILOT_URL", "http://127.0.0.1:8765")
app = FastAPI()


def authed(req: Request) -> bool:
    return req.headers.get("authorization") == f"Bearer {TOKEN}"


async def relay_op(op, payload):
    try:
        return {"type": "res", "id": "mir_" + uuid.uuid4().hex[:8], "ok": True, "data": await relay.dispatch(op, payload, base_url=HP)}
    except relay.MirrorRelayError as exc:
        return {"type": "res", "id": "x", "ok": False, "error": str(exc)}


@app.post("/pair")
async def pair(body: dict):
    if body.get("code") == PAIR_CODE:
        return {"ok": True, "token": TOKEN, "device_id": "dev_mirror"}
    return {"ok": False, "error": "Invalid pairing code"}


@app.get("/v1/mirror/nodes")
async def nodes(req: Request):
    if not authed(req):
        return JSONResponse({"detail": "no"}, 401)
    return [{"node_id": "dev_mirror", "node_name": "SmartMirror", "online": False},
            {"node_id": "dev_pc", "node_name": "Home PC", "online": True, "capabilities": ["chat", "homepilot.mirror"]}]


@app.get("/v1/mirror/nodes/{node}/manifest")
async def manifest(node: str, req: Request):
    return await relay_op("homepilot.mirror.manifest", {})


@app.post("/v1/mirror/nodes/{node}/jobs")
async def create(node: str, body: dict, req: Request):
    if not authed(req) or node != "dev_pc":
        return JSONResponse({"detail": "Node not found"}, 404)
    res = await relay_op("homepilot.mirror.job.create", body)
    res["node_id"] = node
    return JSONResponse(res, 202)


@app.get("/v1/mirror/jobs/{job_id}")
async def get(job_id: str, node_id: str, req: Request):
    if not authed(req):
        return JSONResponse({"detail": "no"}, 401)
    return await relay_op("homepilot.mirror.job.get", {"job_id": job_id})


@app.get("/v1/models")
async def models(req: Request):
    return {"data": [{"id": "persona:stylist--9f8e7d6c", "name": "Stylist"}]}


@app.post("/v1/chat/completions")
async def chat(body: dict):
    owned = [m["content"] for m in body["messages"] if m["role"] == "system" and m["content"].startswith("Owned items")]
    text = ("Grounded: " + owned[0].splitlines()[1]) if owned else "General advice."
    return {"choices": [{"message": {"role": "assistant", "content": text}}]}
