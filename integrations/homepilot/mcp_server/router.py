from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from services.api.app.database import get_db
from services.api.app.models import GenerationJob, WardrobeItem
from smartmirror.stylist.service import suggest
from smartmirror.tryon.service import create_tryon_job

router = APIRouter()

ToolHandler = Callable[[dict[str, Any], Session], Awaitable[Any]]


def _item_dict(x: WardrobeItem) -> dict[str, Any]:
    return {
        "id": x.id,
        "category": x.category,
        "subcategory": x.subcategory,
        "color": x.color,
        "material": x.material,
        "fit": x.fit,
        "length": x.length,
        "metadata": x.metadata_json,
    }


async def _wardrobe_list(args: dict[str, Any], db: Session) -> Any:
    profile_id = str(args.get("profile_id") or "local-user")
    items = list(db.scalars(select(WardrobeItem).where(WardrobeItem.profile_id == profile_id)))
    return [_item_dict(x) for x in items]


async def _wardrobe_add(args: dict[str, Any], db: Session) -> Any:
    category = str(args.get("category") or "").strip()
    if not category:
        raise ValueError("category is required")

    def opt(key: str) -> str | None:
        value = args.get(key)
        return str(value) if value else None

    item = WardrobeItem(
        profile_id=str(args.get("profile_id") or "local-user"),
        category=category,
        subcategory=opt("subcategory"),
        color=opt("color"),
        material=opt("material"),
        fit=opt("fit"),
        length=opt("length"),
        metadata_json=dict(args.get("metadata") or {}),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_dict(item)


async def _style_suggest(args: dict[str, Any], db: Session) -> Any:
    req, outfits = suggest(
        db,
        profile_id=str(args.get("profile_id") or "local-user"),
        prompt=str(args.get("prompt") or ""),
        limit=int(args.get("limit") or 3),
    )
    return {
        "request_id": req.id,
        "normalized_intent": req.normalized_intent,
        "outfits": [
            {
                "id": o.id,
                "item_ids": o.item_ids,
                "score": o.score,
                "explanation": o.explanation,
            }
            for o in outfits
        ],
    }


async def _tryon_create(args: dict[str, Any], db: Session) -> Any:
    job = create_tryon_job(
        db,
        profile_id=str(args.get("profile_id") or "local-user"),
        outfit_id=str(args["outfit_id"]),
        body_capture_ref=str(args["body_capture_ref"]),
        instruction=str(args.get("instruction") or ""),
    )
    return {"job_id": job.id, "status": job.status}


async def _job_get(args: dict[str, Any], db: Session) -> Any:
    job = db.get(GenerationJob, str(args["job_id"]))
    if job is None:
        raise ValueError("Job not found")
    return {
        "id": job.id,
        "status": job.status,
        "progress": job.progress,
        "result": job.result_json,
        "error_code": job.error_code,
    }


TOOLS: dict[str, dict[str, Any]] = {
    "hp.smartmirror.wardrobe_list": {
        "description": "List wardrobe items owned by a SmartMirror profile.",
        "inputSchema": {
            "type": "object",
            "properties": {"profile_id": {"type": "string"}},
        },
        "handler": _wardrobe_list,
    },
    "hp.smartmirror.wardrobe_add": {
        "description": "Add a garment to a SmartMirror profile's wardrobe.",
        "inputSchema": {
            "type": "object",
            "required": ["category"],
            "properties": {
                "profile_id": {"type": "string"},
                "category": {"type": "string"},
                "subcategory": {"type": "string"},
                "color": {"type": "string"},
                "material": {"type": "string"},
                "fit": {"type": "string"},
                "length": {"type": "string"},
                "metadata": {"type": "object"},
            },
        },
        "handler": _wardrobe_add,
    },
    "hp.smartmirror.style_suggest": {
        "description": "Suggest outfits using items from the user's real SmartMirror wardrobe.",
        "inputSchema": {
            "type": "object",
            "required": ["prompt"],
            "properties": {
                "profile_id": {"type": "string"},
                "prompt": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 8},
            },
        },
        "handler": _style_suggest,
    },
    "hp.smartmirror.tryon_create": {
        "description": "Create an asynchronous virtual try-on job for a saved outfit and body capture.",
        "inputSchema": {
            "type": "object",
            "required": ["outfit_id", "body_capture_ref"],
            "properties": {
                "profile_id": {"type": "string"},
                "outfit_id": {"type": "string"},
                "body_capture_ref": {"type": "string"},
                "instruction": {"type": "string"},
            },
        },
        "handler": _tryon_create,
    },
    "hp.smartmirror.job_get": {
        "description": "Poll the status of an asynchronous SmartMirror job such as a try-on.",
        "inputSchema": {
            "type": "object",
            "required": ["job_id"],
            "properties": {"job_id": {"type": "string"}},
        },
        "handler": _job_get,
    },
}


@router.post("/rpc")
async def rpc(request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    body = await request.json()
    request_id = body.get("id")
    method = body.get("method")
    params = body.get("params") or {}

    if method == "tools/list":
        tools = [
            {"name": name, "description": spec["description"], "inputSchema": spec["inputSchema"]}
            for name, spec in TOOLS.items()
        ]
        return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": {"tools": tools}})

    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        spec = TOOLS.get(name)
        if spec is None:
            return JSONResponse(
                {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": f"Unknown tool: {name}"}},
                status_code=404,
            )
        try:
            result = await spec["handler"](arguments, db)
            return JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "content": [{"type": "text", "text": json.dumps(result)}],
                        "structuredContent": result,
                    },
                }
            )
        except Exception as exc:
            return JSONResponse(
                {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32000, "message": str(exc)}},
                status_code=400,
            )

    return JSONResponse(
        {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": f"Unsupported method: {method}"}},
        status_code=400,
    )
