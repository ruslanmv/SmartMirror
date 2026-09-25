"""Shopping (SM-7): "complete the look" for gaps the wardrobe can't fill.

Link-out first (D7): a search link on the retailer's own site, opened on the
owner's phone via QR. No product API, no prices scraped, nothing bought for
the owner. The Amazon Creators API provider can be added behind
SMARTMIRROR_SHOPPING=creators once the Associates account qualifies.
"""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlencode

from sqlalchemy.orm import Session

from services.api.app.config import get_settings
from services.api.app.models import ShoppingCandidate
from smartmirror.privacy import record


class ShoppingUnavailable(RuntimeError):
    pass


@dataclass
class Offer:
    title: str
    url: str
    provider: str


class LinkOutProvider:
    name = "amazon-linkout"

    def __init__(self, domain: str = "com", partner_tag: str = ""):
        self.domain = domain.strip(".") or "com"
        self.partner_tag = partner_tag

    def search(self, query: str) -> list[Offer]:
        params = {"k": query}
        if self.partner_tag:
            params["tag"] = self.partner_tag
        url = f"https://www.amazon.{self.domain}/s?{urlencode(params)}"
        return [Offer(title=f"Search Amazon for “{query}”", url=url, provider=self.name)]


def provider():
    s = get_settings()
    mode = s.smartmirror_shopping
    if mode == "linkout":
        return LinkOutProvider(s.amazon_domain, s.amazon_partner_tag)
    if mode == "creators":
        raise ShoppingUnavailable("CAPABILITY_UNAVAILABLE: the Amazon Creators API provider is not enabled in this build")
    raise ShoppingUnavailable("CAPABILITY_UNAVAILABLE: shopping suggestions are off (SMARTMIRROR_SHOPPING=linkout)")


def suggest(db: Session, *, profile_id: str, category: str, color: str | None = None) -> list[ShoppingCandidate]:
    query = " ".join(p for p in (color, category) if p).strip()[:120]
    if not query:
        raise ValueError("category is required")
    offers = provider().search(query)
    rows = [
        ShoppingCandidate(profile_id=profile_id, query=query, gap_category=category[:64], provider=o.provider,
                          title=o.title[:300], url=o.url[:1000])
        for o in offers
    ]
    db.add_all(rows)
    record(db, profile_id, "shopping.suggested")
    db.commit()
    return rows


def mark_purchased(db: Session, *, profile_id: str, candidate_id: str) -> ShoppingCandidate:
    row = db.get(ShoppingCandidate, candidate_id)
    if row is None or row.profile_id != profile_id:
        raise ValueError("Suggestion not found")
    row.purchased = True
    record(db, profile_id, "shopping.purchased", row.id)
    db.commit()
    return row
