from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from services.api.app.database import get_db
from services.api.app.models import CaptureSession, GenerationJob, WardrobeItem
from services.api.app.config import get_settings
from smartmirror import media
from smartmirror.privacy import delete_profile_data, record
from smartmirror.storage import get_store
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
    db.flush()
    record(db, item.profile_id, "wardrobe.item_added", item.id)
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
    result = dict(job.result_json or {})
    preview_id = result.get("preview_asset_id")
    if job.status == "succeeded" and isinstance(preview_id, str):
        # A small JPEG travels back through the relay; the full image stays here.
        try:
            data, _ = media.load(db, get_store(), preview_id, job.profile_id)
            result["preview_url"] = media.as_data_url(data)
        except media.MediaRejected:
            result["preview_expired"] = True
    return {
        "id": job.id,
        "status": job.status,
        "progress": job.progress,
        "result": result,
        "error_code": job.error_code,
    }


async def _capture_upload(args: dict[str, Any], db: Session) -> Any:
    settings = get_settings()
    purpose = str(args.get("purpose") or "body")
    if purpose not in ("body", "garment"):
        raise ValueError('purpose must be "body" or "garment"')
    data = media.decode_data_url(str(args.get("image") or ""), settings.smartmirror_max_upload_mb * 1024 * 1024)
    asset = media.ingest(
        db,
        get_store(),
        profile_id=str(args.get("profile_id") or "local-user"),
        kind="capture" if purpose == "body" else "garment",
        data=data,
        ttl_hours=settings.smartmirror_body_capture_ttl_hours if purpose == "body" else None,
    )
    return {
        "asset_id": asset.id,
        "content_type": asset.content_type,
        "size_bytes": asset.size_bytes,
        "expires_at": asset.expires_at.isoformat() if asset.expires_at else None,
    }


async def _profile_delete(args: dict[str, Any], db: Session) -> Any:
    if args.get("confirm") != "DELETE":
        raise ValueError('confirm must be "DELETE"')
    profile_id = str(args.get("profile_id") or "local-user")
    return {"deleted": delete_profile_data(db, get_store(), profile_id)}


CAPTURE_SESSION_MINUTES = 10


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


async def _capture_session_create(args: dict[str, Any], db: Session) -> Any:
    purpose = str(args.get("purpose") or "body")
    if purpose not in ("body", "garment"):
        raise ValueError('purpose must be "body" or "garment"')
    cap = CaptureSession(
        profile_id=str(args.get("profile_id") or "local-user"),
        purpose=purpose,
        expires_at=datetime.now(UTC) + timedelta(minutes=CAPTURE_SESSION_MINUTES),
    )
    db.add(cap)
    db.commit()
    return {"session_id": cap.id, "purpose": cap.purpose, "expires_at": cap.expires_at.isoformat()}


def _open_session(db: Session, args: dict[str, Any]) -> CaptureSession:
    cap = db.get(CaptureSession, str(args.get("session_id") or ""))
    if cap is None or cap.profile_id != str(args.get("profile_id") or "local-user"):
        raise ValueError("Capture session not found")
    if cap.status == "waiting" and _aware(cap.expires_at) < datetime.now(UTC):
        cap.status = "expired"
        db.commit()
    return cap


async def _capture_session_complete(args: dict[str, Any], db: Session) -> Any:
    cap = _open_session(db, args)
    if cap.status != "waiting":
        raise ValueError(f"Capture session is {cap.status}")
    asset_id = str(args.get("asset_id") or "")
    media.load(db, get_store(), asset_id, cap.profile_id)  # must exist for this profile
    cap.asset_id, cap.status = asset_id, "received"
    record(db, cap.profile_id, "capture.received", cap.id)
    db.commit()
    return {"session_id": cap.id, "status": cap.status}


async def _capture_session_get(args: dict[str, Any], db: Session) -> Any:
    cap = _open_session(db, args)
    out: dict[str, Any] = {"session_id": cap.id, "status": cap.status, "asset_id": cap.asset_id}
    if cap.status == "received" and cap.asset_id:
        try:
            data, _ = media.load(db, get_store(), cap.asset_id, cap.profile_id)
            out["preview_url"] = media.as_data_url(data, max_edge=1280)
        except media.MediaRejected:
            out["status"] = "expired"
    return out


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
    "hp.smartmirror.capture_upload": {
        "description": "Store a photo on the owner's PC (body photos expire; EXIF removed). Returns an asset id.",
        "inputSchema": {
            "type": "object",
            "required": ["image"],
            "properties": {
                "profile_id": {"type": "string"},
                "image": {"type": "string", "description": "JPEG, PNG or WebP data URL"},
                "purpose": {"type": "string", "enum": ["body", "garment"]},
            },
        },
        "handler": _capture_upload,
    },
    "hp.smartmirror.capture_session_create": {
        "description": "Start a phone-to-screen photo hand-off (expires in 10 minutes).",
        "inputSchema": {
            "type": "object",
            "properties": {"profile_id": {"type": "string"}, "purpose": {"type": "string", "enum": ["body", "garment"]}},
        },
        "handler": _capture_session_create,
    },
    "hp.smartmirror.capture_session_complete": {
        "description": "Attach an uploaded photo (asset id) to a waiting capture session.",
        "inputSchema": {
            "type": "object",
            "required": ["session_id", "asset_id"],
            "properties": {"profile_id": {"type": "string"}, "session_id": {"type": "string"}, "asset_id": {"type": "string"}},
        },
        "handler": _capture_session_complete,
    },
    "hp.smartmirror.capture_session_get": {
        "description": "Poll a capture session; returns a small preview once the photo arrived.",
        "inputSchema": {
            "type": "object",
            "required": ["session_id"],
            "properties": {"profile_id": {"type": "string"}, "session_id": {"type": "string"}},
        },
        "handler": _capture_session_get,
    },
    "hp.smartmirror.profile_delete": {
        "description": "Delete everything SmartMirror stores for a profile (wardrobe, photos, looks, history).",
        "inputSchema": {
            "type": "object",
            "required": ["confirm"],
            "properties": {"profile_id": {"type": "string"}, "confirm": {"type": "string", "enum": ["DELETE"]}},
        },
        "handler": _profile_delete,
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
