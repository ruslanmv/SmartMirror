"""Stylist v2 (SM-5): complete outfits from owned pieces, sets, and gaps.

Pure functions over simple item views, so the scoring is easy to test and
tune. An outfit fills slots — a dress, or a top with a bottom; optional
outerwear; shoes; an optional bag or accessory — and every explanation cites
only the pieces it uses (grounded, like MeetingSense answers).
"""
from __future__ import annotations

import itertools
import re
from dataclasses import dataclass, field

NEUTRALS = {"black", "white", "ivory", "cream", "beige", "camel", "grey", "charcoal", "navy", "brown", "denim", "silver", "gold"}

# Occasion -> preferred subcategories (bonus) and ones to avoid (penalty).
OCCASIONS: dict[str, tuple[set[str], set[str]]] = {
    "evening": ({"dress", "slip dress", "heels", "blazer", "blouse", "skirt", "handbag"}, {"sneakers", "hoodie", "shorts"}),
    "office": ({"blazer", "trousers", "shirt", "blouse", "coat", "boots", "heels"}, {"hoodie", "shorts", "sandals"}),
    "casual": ({"jeans", "t-shirt", "sneakers", "sweater", "jacket", "shorts"}, {"heels", "slip dress"}),
    "active": ({"sneakers", "t-shirt", "shorts", "hoodie", "tank top"}, {"heels", "blazer", "slip dress"}),
    "travel": ({"sneakers", "sweater", "jeans", "trousers", "coat", "jacket"}, {"heels"}),
}
OCCASION_WORDS = {
    "evening": r"dinner|date|party|cocktail|wedding|gala|night out|evening|theatre|opera",
    "office": r"office|work|meeting|interview|business|presentation",
    "casual": r"weekend|brunch|casual|relaxed|coffee|shopping|errand",
    "active": r"gym|run|sport|hike|yoga|workout",
    "travel": r"travel|flight|trip|airport|train",
}
COLD = r"cold|chilly|winter|rain|wind|autumn|fall"
WARM = r"hot|summer|warm|beach|sunny"


@dataclass
class ItemView:
    id: str
    category: str
    subcategory: str | None = None
    color: str | None = None
    name: str | None = None

    @property
    def label(self) -> str:
        if self.name:
            return self.name
        return " ".join(p for p in (self.color, self.subcategory or self.category) if p)


@dataclass
class Intent:
    raw: str
    colors: list[str] = field(default_factory=list)
    categories: list[str] = field(default_factory=list)
    occasion: str | None = None
    cold: bool = False
    warm: bool = False


@dataclass
class Look:
    item_ids: list[str]
    score: float
    explanation: str
    title: str


def parse_intent(prompt: str, known_colors: set[str]) -> Intent:
    text = prompt.lower()
    occasion = next((occ for occ, pat in OCCASION_WORDS.items() if re.search(pat, text)), None)
    colors = [c for c in sorted(known_colors | NEUTRALS | {"red", "blue", "green", "pink", "purple", "yellow", "orange", "burgundy", "emerald", "olive"}) if re.search(rf"\b{re.escape(c)}\b", text)]
    cats = [c for c in ("dress", "skirt", "top", "blouse", "shirt", "jacket", "blazer", "coat", "jeans", "trousers", "pants", "shorts", "shoes", "boots", "heels", "sneakers", "bag") if re.search(rf"\b{c}s?\b", text)]
    return Intent(raw=prompt, colors=colors, categories=cats, occasion=occasion,
                  cold=bool(re.search(COLD, text)), warm=bool(re.search(WARM, text)))


def _item_score(item: ItemView, intent: Intent) -> float:
    s = 0.3
    kinds = {item.category, item.subcategory or ""}
    if item.color and item.color in intent.colors:
        s += 0.35
    if kinds & set(intent.categories) or ("pants" in intent.categories and item.subcategory == "trousers"):
        s += 0.35
    if intent.occasion:
        good, bad = OCCASIONS[intent.occasion]
        if kinds & good:
            s += 0.2
        if kinds & bad:
            s -= 0.35
    return s


def _harmony(items: list[ItemView]) -> float:
    """Neutrals go with anything; more than one bold colour costs a little."""
    bold = {i.color for i in items if i.color and i.color not in NEUTRALS}
    return 0.1 if len(bold) <= 1 else -0.08 * (len(bold) - 1)


def _slots(items: list[ItemView]) -> dict[str, list[ItemView]]:
    slots: dict[str, list[ItemView]] = {k: [] for k in ("dress", "top", "bottom", "outerwear", "shoes", "extra")}
    for it in items:
        key = it.category if it.category in slots else ("extra" if it.category in ("bag", "accessory") else None)
        if key:
            slots[key].append(it)
    return slots


def _title(anchor: ItemView, intent: Intent) -> str:
    base = {"evening": "Evening", "office": "Office", "casual": "Easy", "active": "Active", "travel": "Travel"}.get(intent.occasion or "", "Everyday")
    return f"{base} {anchor.subcategory or anchor.category}".strip().capitalize()


def explain(look_items: list[ItemView], intent: Intent) -> str:
    """Grounded: mentions only the chosen pieces, by their own names."""
    anchor, rest = look_items[0], look_items[1:]
    parts = [f"The {anchor.label.lower()} leads"]
    if rest:
        names = [i.label.lower() for i in rest]
        parts.append("with the " + (", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else names[0]))
    reason = {
        "evening": "polished for the evening",
        "office": "sharp enough for work",
        "casual": "relaxed and easy",
        "active": "ready to move",
        "travel": "comfortable for a long day",
    }.get(intent.occasion or "", "balanced and wearable")
    if intent.cold and any(i.category == "outerwear" for i in look_items):
        reason += ", with a layer for the cold"
    return f"{' '.join(parts)} — {reason}."


def build_looks(items: list[ItemView], intent: Intent, limit: int = 3, avoid_anchors: set[str] | None = None) -> list[Look]:
    """Up to `limit` complete outfits with different anchors, best first."""
    slots = _slots(items)
    score = {i.id: _item_score(i, intent) for i in items}
    top = lambda slot, n=3: sorted(slots[slot], key=lambda i: score[i.id], reverse=True)[:n]

    bases: list[list[ItemView]] = [[d] for d in top("dress", 4)]
    bases += [[t, b] for t, b in itertools.product(top("top", 3), top("bottom", 3))]
    looks: list[tuple[float, list[ItemView]]] = []
    for base in bases:
        look = list(base)
        want_layer = intent.cold or intent.occasion in ("office", "evening")
        if slots["outerwear"] and want_layer:
            look.append(top("outerwear", 1)[0])
        if slots["shoes"]:
            look.append(top("shoes", 1)[0])
        if slots["extra"] and intent.occasion == "evening":
            look.append(top("extra", 1)[0])
        total = sum(score[i.id] for i in look) / len(look) + _harmony(look)
        if intent.warm and any(i.category == "outerwear" for i in look):
            total -= 0.1
        looks.append((total, look))

    looks.sort(key=lambda t: t[0], reverse=True)
    chosen: list[Look] = []
    used_anchors = set(avoid_anchors or ())
    for total, look in looks:
        anchor = look[0]
        if anchor.id in used_anchors:
            continue
        used_anchors.add(anchor.id)
        chosen.append(Look(
            item_ids=[i.id for i in look],
            score=round(max(0.0, min(1.0, total)), 3),
            explanation=explain(look, intent),
            title=_title(anchor, intent),
        ))
        if len(chosen) >= limit:
            break
    return chosen


def gaps(items: list[ItemView], intent: Intent) -> list[dict[str, str]]:
    """Slots the wardrobe cannot fill for this request — what to shop for."""
    slots = _slots(items)
    out: list[dict[str, str]] = []
    if not slots["dress"] and not (slots["top"] and slots["bottom"]):
        missing = "top" if not slots["top"] else "bottom"
        out.append({"slot": missing, "category": missing})
    if not slots["shoes"]:
        out.append({"slot": "shoes", "category": "shoes"})
    if intent.cold and not slots["outerwear"]:
        out.append({"slot": "outerwear", "category": "outerwear"})
    good = OCCASIONS.get(intent.occasion or "", (set(), set()))[0]
    owned = {i.subcategory for i in items} | {i.category for i in items}
    for want in ("heels", "blazer", "sneakers"):
        if want in good and want not in owned and not any(g["slot"] == ("shoes" if want != "blazer" else "outerwear") for g in out):
            out.append({"slot": "shoes" if want != "blazer" else "outerwear", "category": want})
            break
    colour = intent.colors[0] if intent.colors else None
    for g in out:
        g["query"] = " ".join(p for p in (colour, g["category"]) if p)
    return out


def plan_set(items: list[ItemView], intent: Intent, days: int) -> list[Look]:
    """A week or trip: one look per day, rotating anchors before repeating."""
    days = max(1, min(14, days))
    plan: list[Look] = []
    used: set[str] = set()
    while len(plan) < days:
        batch = build_looks(items, intent, limit=days - len(plan), avoid_anchors=used)
        if not batch:
            if not used:
                break
            used = set()  # every anchor used once: allow repeats
            continue
        for look in batch:
            used.add(look.item_ids[0])
            plan.append(look)
    return plan[:days]
