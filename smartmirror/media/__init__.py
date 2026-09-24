"""Media ingest (SM-2): validate, strip metadata, downscale, dedupe, store.

Photos arrive as data URLs (from the screen or the phone), are re-encoded so
EXIF (GPS, device serials) never reaches storage, and are stored as Assets
with a TTL when they show a body.
"""
from __future__ import annotations

import base64
import binascii
import io
import re
from datetime import UTC, datetime, timedelta

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from services.api.app.models import Asset
from smartmirror.privacy import record
from smartmirror.storage import MediaStore, make_key, sha256

_DATA_URL = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,(.+)$", re.S)
KINDS = {"capture", "garment", "cutout", "thumbnail", "mask", "preview"}
MAX_EDGE = 1600


class MediaRejected(ValueError):
    """RESOURCE_REJECTED: the image cannot be accepted."""


def decode_data_url(value: str, max_bytes: int) -> bytes:
    m = _DATA_URL.match(value or "")
    if not m:
        raise MediaRejected("RESOURCE_REJECTED: expected a JPEG, PNG or WebP data URL")
    if len(m.group(2)) > (max_bytes * 4) // 3 + 16:
        raise MediaRejected("RESOURCE_REJECTED: image too large")
    try:
        return base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise MediaRejected("RESOURCE_REJECTED: invalid base64") from None


def normalize_image(data: bytes, *, max_edge: int = MAX_EDGE, quality: int = 88) -> tuple[bytes, str]:
    """Re-encode (drops EXIF/ICC/text), apply orientation, cap the long edge."""
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
        img = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, OSError, SyntaxError):
        raise MediaRejected("RESOURCE_REJECTED: not a readable image") from None
    if img.format not in ("JPEG", "PNG", "WEBP"):
        raise MediaRejected("RESOURCE_REJECTED: only JPEG, PNG or WebP images are accepted")
    img = ImageOps.exif_transpose(img)
    img.thumbnail((max_edge, max_edge))
    out = io.BytesIO()
    if img.mode == "RGBA" or (img.mode in ("LA", "P") and "transparency" in img.info):
        img.convert("RGBA").save(out, "PNG", optimize=True)
        return out.getvalue(), "image/png"
    img.convert("RGB").save(out, "JPEG", quality=quality, optimize=True)
    return out.getvalue(), "image/jpeg"


def ingest(
    db: Session,
    store: MediaStore,
    *,
    profile_id: str,
    kind: str,
    data: bytes,
    ttl_hours: int | None,
    max_edge: int = MAX_EDGE,
) -> Asset:
    """Store an image as an Asset (deduplicated per profile and kind)."""
    if kind not in KINDS:
        raise ValueError(f"unknown asset kind: {kind}")
    clean, content_type = normalize_image(data, max_edge=max_edge)
    digest = sha256(clean)
    expires = datetime.now(UTC) + timedelta(hours=ttl_hours) if ttl_hours else None
    existing = db.scalars(
        select(Asset).where(Asset.profile_id == profile_id, Asset.kind == kind, Asset.sha256 == digest)
    ).first()
    if existing:
        if expires and (existing.expires_at is None or _aware(existing.expires_at) < expires):
            existing.expires_at = expires
            db.commit()
        return existing
    asset = Asset(profile_id=profile_id, kind=kind, content_type=content_type, size_bytes=len(clean), sha256=digest, storage_key="")
    db.add(asset)
    db.flush()
    asset.storage_key = make_key(kind, asset.id, content_type)
    asset.expires_at = expires
    store.put(asset.storage_key, clean, content_type)
    record(db, profile_id, f"media.{kind}_stored", asset.id)
    db.commit()
    db.refresh(asset)
    return asset


def load(db: Session, store: MediaStore, asset_id: str, profile_id: str) -> tuple[bytes, Asset]:
    asset = db.get(Asset, asset_id)
    if asset is None or asset.profile_id != profile_id:
        raise MediaRejected("RESOURCE_REJECTED: image not found")
    if asset.expires_at and _aware(asset.expires_at) < datetime.now(UTC):
        raise MediaRejected("RESOURCE_REJECTED: image expired")
    return store.get(asset.storage_key), asset


def as_data_url(data: bytes, *, max_edge: int = 1024, quality: int = 85) -> str:
    """A small JPEG data URL for sending a preview back through the relay."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    img.thumbnail((max_edge, max_edge))
    out = io.BytesIO()
    img.convert("RGB").save(out, "JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
