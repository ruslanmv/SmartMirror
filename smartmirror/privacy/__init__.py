"""Privacy: audit events (never content), retention and delete-everything."""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from services.api.app.models import (
    Asset,
    AuditEvent,
    CaptureSession,
    ClassificationRun,
    GenerationJob,
    Outfit,
    OutfitSet,
    OutfitSetMember,
    ShoppingCandidate,
    StylingRequest,
    WardrobeItem,
)
from smartmirror.storage import MediaStore


def record(db: Session, profile_id: str, event: str, subject_id: str | None = None) -> None:
    """Log that something happened. Never pass prompts, photos or item details."""
    db.add(AuditEvent(profile_id=profile_id, event=event[:64], subject_id=subject_id))


def sweep_expired(db: Session, store: MediaStore, now: datetime | None = None) -> int:
    """Delete assets past their TTL (body captures, previews). Returns the count."""
    now = now or datetime.now(UTC)
    expired = list(db.scalars(select(Asset).where(Asset.expires_at.is_not(None), Asset.expires_at < now)))
    for asset in expired:
        store.delete(asset.storage_key)
        db.delete(asset)
    for cap in db.scalars(select(CaptureSession).where(CaptureSession.expires_at < now, CaptureSession.status == "waiting")):
        cap.status = "expired"
    db.commit()
    return len(expired)


def delete_profile_data(db: Session, store: MediaStore, profile_id: str) -> dict[str, int]:
    """Remove everything SmartMirror holds for a profile, files included."""
    counts: dict[str, int] = {}
    assets = list(db.scalars(select(Asset).where(Asset.profile_id == profile_id)))
    for asset in assets:
        store.delete(asset.storage_key)
    counts["assets"] = len(assets)

    item_ids = list(db.scalars(select(WardrobeItem.id).where(WardrobeItem.profile_id == profile_id)))
    request_ids = list(db.scalars(select(StylingRequest.id).where(StylingRequest.profile_id == profile_id)))
    set_ids = list(db.scalars(select(OutfitSet.id).where(OutfitSet.profile_id == profile_id)))

    def run(stmt, name: str) -> None:
        counts[name] = db.execute(stmt).rowcount or 0

    if item_ids:
        run(delete(ClassificationRun).where(ClassificationRun.item_id.in_(item_ids)), "classification_runs")
    if request_ids:
        run(delete(Outfit).where(Outfit.styling_request_id.in_(request_ids)), "outfits")
    if set_ids:
        run(delete(OutfitSetMember).where(OutfitSetMember.set_id.in_(set_ids)), "outfit_set_members")
    for model, name in (
        (Asset, "assets_rows"),
        (WardrobeItem, "wardrobe_items"),
        (StylingRequest, "styling_requests"),
        (OutfitSet, "outfit_sets"),
        (ShoppingCandidate, "shopping_candidates"),
        (CaptureSession, "capture_sessions"),
        (GenerationJob, "generation_jobs"),
        (AuditEvent, "audit_events"),
    ):
        run(delete(model).where(model.profile_id == profile_id), name)
    db.commit()
    # One event survives, so the owner can see that a wipe happened.
    record(db, profile_id, "profile.deleted")
    db.commit()
    return counts
