from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from services.api.app.models import Outfit, StylingRequest, WardrobeItem

from . import engine


def normalize_intent(prompt: str) -> dict[str, Any]:
    text = prompt.lower()
    colors = [c for c in ("black", "white", "red", "blue", "green", "pink", "beige", "brown", "navy", "grey", "ivory") if c in text]
    categories = [c for c in ("skirt", "dress", "top", "jacket", "blazer", "jeans", "pants", "shoes", "boots") if c in text]
    styles = [s for s in ("casual", "elegant", "sexy", "sporty", "formal", "minimal") if re.search(rf"\b{s}\b", text)]
    return {"colors": colors, "categories": categories, "styles": styles, "raw": prompt}


def _tags(meta: dict[str, Any], key: str) -> tuple[str, ...]:
    value = meta.get(key)
    return tuple(str(v).lower() for v in value if isinstance(v, str)) if isinstance(value, list) else ()


def view(item: WardrobeItem) -> engine.ItemView:
    meta = item.metadata_json or {}
    name = meta.get("name")
    return engine.ItemView(
        id=item.id,
        category=(item.category or "").lower(),
        subcategory=(item.subcategory or "").lower() or None,
        color=(item.color or "").lower() or None,
        name=name if isinstance(name, str) and name.strip() else None,
        vibes=_tags(meta, "vibes"),
        occasions=_tags(meta, "occasions"),
    )


def owned(db: Session, profile_id: str) -> list[engine.ItemView]:
    # Only pieces the owner confirmed; drafts wait in the review queue.
    rows = db.scalars(select(WardrobeItem).where(WardrobeItem.profile_id == profile_id, WardrobeItem.status == "confirmed"))
    return [view(i) for i in rows]


def suggest(
    db: Session,
    profile_id: str,
    prompt: str,
    limit: int = 3,
    *,
    hour: int | None = None,
    anchor_id: str | None = None,
) -> tuple[StylingRequest, list[Outfit]]:
    """Complete outfits from the owner's confirmed pieces (stylist v2).

    normalized_intent carries the parsed occasion, vibe and time, the wardrobe
    gaps (what to shop for), the one clarifying question worth asking and a
    follow-up offer, alongside the legacy fields. `hour` is the screen's local
    hour; `anchor_id` keeps only looks that wear that piece.
    """
    items = owned(db, profile_id)
    intent = engine.parse_intent(prompt, {i.color for i in items if i.color}, hour=hour)
    looks = engine.build_looks(items, intent, limit=limit, must_include=anchor_id)
    anchor = next((i for i in items if i.id == anchor_id), None)
    normalized = {
        **normalize_intent(prompt),
        "occasion": intent.occasion,
        "vibe": intent.vibe,
        "time": intent.time,
        "cold": intent.cold,
        "gaps": engine.gaps(items, intent),
        "question": engine.clarification(intent),
        "offer": engine.offer(intent),
        "pairing_line": engine.pairing_line(anchor, looks[0], items) if anchor and looks else None,
    }
    req = StylingRequest(profile_id=profile_id, prompt=prompt, normalized_intent=normalized)
    db.add(req)
    db.flush()
    outfits = [
        Outfit(styling_request_id=req.id, score=look.score, explanation=look.explanation, item_ids=look.item_ids, title=look.title)
        for look in looks
    ]
    db.add_all(outfits)
    db.commit()
    return req, outfits
