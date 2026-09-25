"""Adding clothes (M3): photo -> draft item with AI suggestions -> owner confirms.

The owner's confirmation always wins: user_metadata overrides ai_metadata and
the effective values live in the item's columns. Draft items are not used by
the stylist until confirmed.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from services.api.app.models import Asset, ClassificationRun, WardrobeItem
from smartmirror import media
from smartmirror.ml import get_classifier, needs_review
from smartmirror.ml.labels import CATEGORIES, SUBCATEGORIES
from smartmirror.privacy import record
from smartmirror.storage import MediaStore

EDITABLE = ("category", "subcategory", "color", "material", "fit", "length")


def ingest_garment(db: Session, store: MediaStore, *, profile_id: str, data: bytes, name: str | None = None) -> WardrobeItem:
    asset = media.ingest(db, store, profile_id=profile_id, kind="garment", data=data, ttl_hours=None)
    existing = db.scalars(
        select(WardrobeItem).where(WardrobeItem.profile_id == profile_id, WardrobeItem.image_asset_id == asset.id)
    ).first()
    if existing:  # the same photo twice: keep one item
        return existing

    image, _ = media.load(db, store, asset.id, profile_id)
    result = get_classifier().classify(image)
    margin = result.extra.get("category_margin")
    review = [
        f
        for f, guess, m in (
            ("category", result.category, margin),
            ("subcategory", result.subcategory, result.extra.get("subcategory_margin")),
            ("color", result.color, None),
        )
        if needs_review(guess, m)
    ]
    ai = {
        "category": result.category.value,
        "subcategory": result.subcategory.value,
        "color": result.color.value,
        "pattern": result.pattern.value,
        "confidence": {
            "category": result.category.confidence,
            "subcategory": result.subcategory.confidence,
            "color": result.color.confidence,
            "pattern": result.pattern.confidence,
        },
        "alternatives": {
            "category": result.category.alternatives,
            "subcategory": result.subcategory.alternatives,
            "color": result.color.alternatives,
        },
        "needs_review": review,
        "model_id": result.model_id,
    }
    item = WardrobeItem(
        profile_id=profile_id,
        category=result.category.value or "unsorted",
        subcategory=result.subcategory.value,
        color=result.color.value,
        metadata_json={"name": name} if name else {},
        status="draft",
        ai_metadata=ai,
        image_asset_id=asset.id,
    )
    db.add(item)
    db.flush()
    db.add(ClassificationRun(item_id=item.id, model_id=result.model_id, model_version=result.model_version,
                             output_json=result.to_dict(), duration_ms=result.duration_ms))
    record(db, profile_id, "wardrobe.item_ingested", item.id)
    db.commit()
    db.refresh(item)
    return item


def confirm(db: Session, *, profile_id: str, item_id: str, changes: dict[str, Any]) -> WardrobeItem:
    item = db.get(WardrobeItem, item_id)
    if item is None or item.profile_id != profile_id:
        raise ValueError("Wardrobe item not found")
    user = dict(item.user_metadata or {})
    for key in EDITABLE:
        value = changes.get(key)
        if isinstance(value, str) and value.strip():
            user[key] = value.strip()[:64]
            setattr(item, key, user[key])
    name = changes.get("name")
    if isinstance(name, str) and name.strip():
        item.metadata_json = {**(item.metadata_json or {}), "name": name.strip()[:80]}
    if item.subcategory in SUBCATEGORIES and "category" not in user:
        item.category = SUBCATEGORIES[item.subcategory]
    if not item.category or item.category == "unsorted":
        raise ValueError("Choose a category before confirming")
    item.user_metadata = user
    item.status = "confirmed"
    record(db, profile_id, "wardrobe.item_confirmed", item.id)
    db.commit()
    db.refresh(item)
    return item


def remove(db: Session, store: MediaStore, *, profile_id: str, item_id: str) -> None:
    item = db.get(WardrobeItem, item_id)
    if item is None or item.profile_id != profile_id:
        raise ValueError("Wardrobe item not found")
    if item.image_asset_id:
        asset = db.get(Asset, item.image_asset_id)
        others = db.scalars(select(WardrobeItem.id).where(WardrobeItem.image_asset_id == item.image_asset_id, WardrobeItem.id != item.id)).first()
        if asset and not others:
            store.delete(asset.storage_key)
            db.delete(asset)
    db.delete(item)
    record(db, profile_id, "wardrobe.item_removed", item_id)
    db.commit()


def thumbnail(db: Session, store: MediaStore, item: WardrobeItem, edge: int = 256) -> str | None:
    if not item.image_asset_id:
        return None
    try:
        data, _ = media.load(db, store, item.image_asset_id, item.profile_id)
    except media.MediaRejected:
        return None
    return media.as_data_url(data, max_edge=edge, quality=80)


def review_queue(db: Session, store: MediaStore, *, profile_id: str, limit: int = 12) -> list[dict[str, Any]]:
    drafts = list(db.scalars(
        select(WardrobeItem).where(WardrobeItem.profile_id == profile_id, WardrobeItem.status == "draft")
        .order_by(WardrobeItem.created_at.desc()).limit(limit)
    ))
    return [
        {
            "id": d.id,
            "image_url": thumbnail(db, store, d),
            "suggested": {k: (d.ai_metadata or {}).get(k) for k in ("category", "subcategory", "color", "pattern")},
            "confidence": (d.ai_metadata or {}).get("confidence", {}),
            "alternatives": (d.ai_metadata or {}).get("alternatives", {}),
            "needs_review": (d.ai_metadata or {}).get("needs_review", []),
            "categories": CATEGORIES,
        }
        for d in drafts
    ]
