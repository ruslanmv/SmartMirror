from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from services.api.app.models import Outfit, StylingRequest, WardrobeItem


def normalize_intent(prompt: str) -> dict[str, Any]:
    text = prompt.lower()
    colors = [c for c in ("black", "white", "red", "blue", "green", "pink", "beige", "brown") if c in text]
    categories = [c for c in ("skirt", "dress", "top", "jacket", "blazer", "jeans", "pants", "shoes", "boots") if c in text]
    styles = [s for s in ("casual", "elegant", "sexy", "sporty", "formal", "minimal") if re.search(rf"\b{s}\b", text)]
    return {"colors": colors, "categories": categories, "styles": styles, "raw": prompt}


def suggest(db: Session, profile_id: str, prompt: str, limit: int = 3) -> tuple[StylingRequest, list[Outfit]]:
    intent = normalize_intent(prompt)
    req = StylingRequest(profile_id=profile_id, prompt=prompt, normalized_intent=intent)
    db.add(req)
    db.flush()

    # Only pieces the owner confirmed; drafts wait in the review queue.
    items = list(db.scalars(select(WardrobeItem).where(WardrobeItem.profile_id == profile_id, WardrobeItem.status == "confirmed")))
    wanted_colors = set(intent["colors"])
    wanted_categories = set(intent["categories"])

    def score(item: WardrobeItem) -> float:
        value = 0.25
        if item.color and item.color.lower() in wanted_colors:
            value += 0.4
        if item.category.lower() in wanted_categories:
            value += 0.35
        return min(value, 1.0)

    ranked = sorted(items, key=score, reverse=True)
    chosen = ranked[:4]
    outfits: list[Outfit] = []
    if chosen:
        avg = sum(score(i) for i in chosen) / len(chosen)
        outfit = Outfit(
            styling_request_id=req.id,
            score=avg,
            explanation="Initial deterministic wardrobe match; AI provider enrichment is pluggable.",
            item_ids=[i.id for i in chosen],
        )
        db.add(outfit)
        outfits.append(outfit)

    db.commit()
    return req, outfits[:limit]
