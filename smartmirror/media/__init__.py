"""Media ingest (SM-2): validate, strip metadata, downscale, dedupe, store.

Photos arrive as data URLs (from the screen or the phone), are re-encoded so
EXIF (GPS, device serials) never reaches storage, and are stored as Assets
with a TTL when they show a body.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import io
import re
import secrets
import time
from datetime import UTC, datetime, timedelta

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from services.api.app.models import Asset
from smartmirror.privacy import record
from smartmirror.storage import MediaStore, make_key, sha256

_DATA_URL = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,(.+)$", re.DOTALL)
KINDS = {"capture", "garment", "cutout", "thumbnail", "mask", "preview"}
MAX_EDGE = 1600
# A small file can decode to a huge bitmap; refuse anything beyond ~40 megapixels.
MAX_PIXELS = 40_000_000


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
        if img.width * img.height > MAX_PIXELS:
            raise MediaRejected("RESOURCE_REJECTED: image has too many pixels")
        img.verify()
        img = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError):
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


# ── expiring signed URLs ────────────────────────────────────────────────
# Objects have no public URL. A signed URL names one asset, expires within
# minutes (never after the asset itself), and is checked on every request.

_process_secret = secrets.token_bytes(32)


def _url_secret() -> bytes:
    from services.api.app.config import get_settings

    configured = get_settings().smartmirror_media_url_secret
    return configured.encode() if configured else _process_secret


def _signature(asset_id: str, profile_id: str, exp: int) -> str:
    msg = f"{asset_id}:{profile_id}:{exp}".encode()
    return hmac.new(_url_secret(), msg, hashlib.sha256).hexdigest()


def signed_url(asset: Asset, store: MediaStore, ttl_s: int | None = None) -> str:
    """A URL that serves this asset until it expires.

    S3/MinIO: a presigned GET. Local folder: ``/v1/media/{id}?exp=…&sig=…`` on
    the SmartMirror API (relative; the caller adds the host).
    """
    from services.api.app.config import get_settings

    ttl = max(1, min(int(ttl_s or get_settings().smartmirror_media_url_ttl_s), 3600))
    if asset.expires_at:
        left = int((_aware(asset.expires_at) - datetime.now(UTC)).total_seconds())
        if left <= 0:
            raise MediaRejected("RESOURCE_REJECTED: image expired")
        ttl = min(ttl, left)
    presign = getattr(store, "presign", None)
    if callable(presign):
        return presign(asset.storage_key, ttl)
    exp = int(time.time()) + ttl
    return f"/v1/media/{asset.id}?exp={exp}&sig={_signature(asset.id, asset.profile_id, exp)}"


def open_signed(db: Session, store: MediaStore, asset_id: str, exp: str, sig: str) -> tuple[bytes, Asset]:
    """Serve a signed URL: the signature, its expiry and the asset's own TTL must all hold."""
    try:
        exp_at = int(exp)
    except (TypeError, ValueError):
        raise MediaRejected("RESOURCE_REJECTED: invalid link") from None
    asset = db.get(Asset, asset_id)
    if asset is None or not hmac.compare_digest(_signature(asset.id, asset.profile_id, exp_at), sig or ""):
        raise MediaRejected("RESOURCE_REJECTED: invalid link")
    if exp_at < time.time():
        raise MediaRejected("RESOURCE_REJECTED: link expired")
    return load(db, store, asset.id, asset.profile_id)


def as_data_url(data: bytes, *, max_edge: int = 1024, quality: int = 85) -> str:
    """A small JPEG data URL for sending a preview back through the relay."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    img.thumbnail((max_edge, max_edge))
    out = io.BytesIO()
    img.convert("RGB").save(out, "JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
