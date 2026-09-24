from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy import false as sa_false
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class WardrobeItem(Base):
    __tablename__ = "wardrobe_items"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: _id("garment"))
    profile_id: Mapped[str] = mapped_column(String(128), index=True)
    category: Mapped[str] = mapped_column(String(64), index=True)
    subcategory: Mapped[str | None] = mapped_column(String(64), nullable=True)
    color: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    material: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    length: Mapped[str | None] = mapped_column(String(64), nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # Wardrobe intelligence (M0): what the classifier proposed vs what the owner
    # set; effective values live in the columns above. "draft" items wait in the
    # review queue until confirmed.
    status: Mapped[str] = mapped_column(String(16), default="confirmed", server_default="confirmed", index=True)
    ai_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    user_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    image_asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class StylingRequest(Base):
    __tablename__ = "styling_requests"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: _id("style"))
    profile_id: Mapped[str] = mapped_column(String(128), index=True)
    prompt: Mapped[str] = mapped_column(Text)
    normalized_intent: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Outfit(Base):
    __tablename__ = "outfits"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: _id("outfit"))
    styling_request_id: Mapped[str] = mapped_column(ForeignKey("styling_requests.id"), index=True)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    explanation: Mapped[str] = mapped_column(Text, default="")
    item_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class GenerationJob(Base):
    __tablename__ = "generation_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: _id("job"))
    profile_id: Mapped[str] = mapped_column(String(128), index=True)
    job_type: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    progress: Mapped[float] = mapped_column(Float, default=0)
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider_job_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    request_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Asset(Base):
    """A stored file: a body capture, a garment photo, a cut-out, a try-on preview."""

    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: _id("asset"))
    profile_id: Mapped[str] = mapped_column(String(128), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)  # capture|garment|cutout|thumbnail|mask|preview
    content_type: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    storage_key: Mapped[str] = mapped_column(String(256))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ClassificationRun(Base):
    """One classifier pass over one garment photo (model id + version for audits)."""

    __tablename__ = "classification_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: _id("cls"))
    item_id: Mapped[str] = mapped_column(String(64), index=True)
    model_id: Mapped[str] = mapped_column(String(128))
    model_version: Mapped[str] = mapped_column(String(64))
    output_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class OutfitSet(Base):
    """A saved group of outfits: a week plan, a trip, a capsule."""

    __tablename__ = "outfit_sets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: _id("set"))
    profile_id: Mapped[str] = mapped_column(String(128), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # week|trip|capsule|custom
    title: Mapped[str] = mapped_column(String(200))
    params_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class OutfitSetMember(Base):
    __tablename__ = "outfit_set_members"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: _id("setm"))
    set_id: Mapped[str] = mapped_column(ForeignKey("outfit_sets.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(64), default="")  # e.g. "Monday", "Day 2 · dinner"
    item_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    explanation: Mapped[str] = mapped_column(Text, default="")


class ShoppingCandidate(Base):
    """A product suggested to complete a look (link-out; prices are time-stamped)."""

    __tablename__ = "shopping_candidates"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: _id("shop"))
    profile_id: Mapped[str] = mapped_column(String(128), index=True)
    query: Mapped[str] = mapped_column(String(300))
    gap_category: Mapped[str] = mapped_column(String(64))
    provider: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(300))
    url: Mapped[str] = mapped_column(String(1000))
    price_text: Mapped[str | None] = mapped_column(String(64), nullable=True)
    price_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    purchased: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CaptureSession(Base):
    """Phone → screen photo hand-off (short code, expires)."""

    __tablename__ = "capture_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: _id("cap"))
    profile_id: Mapped[str] = mapped_column(String(128), index=True)
    purpose: Mapped[str] = mapped_column(String(16), default="body")  # body|garment
    status: Mapped[str] = mapped_column(String(16), default="waiting")  # waiting|received|expired
    asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AuditEvent(Base):
    """What happened, never the content (no prompts, photos or item details)."""

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: _id("evt"))
    profile_id: Mapped[str] = mapped_column(String(128), index=True)
    event: Mapped[str] = mapped_column(String(64))
    subject_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
