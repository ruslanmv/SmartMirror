"""Stylist v2 (SM-5): complete outfits from owned pieces, sets, and gaps.

Pure functions over simple item views, so the scoring is easy to test and
tune. An outfit fills slots — a dress, or a top with a bottom; optional
outerwear; shoes; an optional bag or accessory — and every explanation cites
only the pieces it uses (grounded, like MeetingSense answers).

A request is read as occasion × vibe (docs/ux/stylist-conversation-review.md):
"love day" is a romantic date, "sexy night" an alluring evening, "lazy day" a
relaxed day at home. The words come from packages/contracts/stylist-lexicon.json,
shared with the web demo so both read a request the same way.
"""
from __future__ import annotations

import itertools
import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

NEUTRALS = {"black", "white", "ivory", "cream", "beige", "camel", "grey", "charcoal", "navy", "brown", "denim", "silver", "gold"}

# Occasion -> preferred subcategories (bonus) and ones to avoid (penalty).
OCCASIONS: dict[str, tuple[set[str], set[str]]] = {
    "evening": ({"dress", "slip dress", "heels", "blazer", "blouse", "skirt", "handbag"}, {"sneakers", "hoodie", "shorts"}),
    "date": ({"dress", "slip dress", "blouse", "skirt", "heels", "handbag", "boots"}, {"hoodie", "sneakers", "shorts"}),
    "office": ({"blazer", "trousers", "shirt", "blouse", "coat", "boots", "heels"}, {"hoodie", "shorts", "sandals"}),
    "interview": ({"blazer", "trousers", "shirt", "blouse", "coat", "heels", "boots"}, {"hoodie", "shorts", "sandals", "sneakers", "jeans"}),
    "casual": ({"jeans", "t-shirt", "sneakers", "sweater", "jacket", "shorts"}, {"heels", "slip dress"}),
    "shopping": ({"jeans", "t-shirt", "sneakers", "sweater", "jacket", "boots", "handbag"}, {"heels", "slip dress"}),
    "home": ({"sweater", "hoodie", "t-shirt", "jeans", "shorts"}, {"heels", "blazer", "slip dress", "boots"}),
    "active": ({"sneakers", "t-shirt", "shorts", "hoodie", "tank top"}, {"heels", "blazer", "slip dress"}),
    "travel": ({"sneakers", "sweater", "jeans", "trousers", "coat", "jacket"}, {"heels"}),
}

# Vibe -> (subcategories that carry it, colours that carry it, subcategories that fight it).
VIBES: dict[str, tuple[set[str], set[str], set[str]]] = {
    "alluring": ({"slip dress", "dress", "skirt", "heels", "tank top", "boots"}, {"black", "red", "burgundy"}, {"hoodie", "sweater", "sneakers"}),
    "romantic": ({"dress", "slip dress", "blouse", "skirt", "heels", "handbag"}, {"red", "pink", "cream", "ivory", "white", "burgundy"}, {"hoodie", "sneakers"}),
    "confident": ({"blazer", "trousers", "shirt", "heels", "boots", "coat"}, {"black", "navy", "charcoal", "white", "red"}, {"hoodie", "shorts"}),
    "relaxed": ({"jeans", "t-shirt", "sweater", "hoodie", "sneakers"}, set(), {"heels", "blazer", "slip dress"}),
    "bold": ({"dress", "skirt", "heels", "jacket"}, {"red", "emerald", "green", "yellow", "orange", "pink", "purple"}, set()),
    "playful": ({"skirt", "dress", "sneakers", "sandals", "t-shirt"}, {"pink", "yellow", "red", "blue"}, {"blazer"}),
    "minimal": ({"t-shirt", "trousers", "shirt", "coat"}, {"black", "white", "grey", "beige", "navy", "camel"}, set()),
    "elegant": ({"dress", "slip dress", "blouse", "heels", "blazer", "coat", "handbag"}, {"black", "ivory", "navy", "camel"}, {"hoodie", "sneakers"}),
    "sporty": ({"sneakers", "t-shirt", "hoodie", "shorts", "tank top"}, set(), {"heels", "blazer"}),
}

COLD = r"cold|chilly|winter|rain|rainy|wind|windy|autumn|fall|snow"
WARM = r"hot day|summer|warm|beach|sunny|heatwave"

TITLES = {
    "evening": "Evening", "date": "Date", "office": "Office", "interview": "Interview", "casual": "Easy",
    "shopping": "Shopping", "home": "Cosy", "active": "Active", "travel": "Travel",
}
VIBE_TITLES = {
    "alluring": "Sultry", "romantic": "Romantic", "confident": "Power", "relaxed": "Easy", "bold": "Statement",
    "playful": "Playful", "minimal": "Minimal", "elegant": "Elegant", "sporty": "Sporty",
}
REASONS = {
    "evening": "polished for the evening",
    "date": "romantic and polished for a date",
    "office": "sharp enough for work",
    "interview": "composed and sharp for an interview",
    "casual": "relaxed and easy",
    "shopping": "easy to walk in all day",
    "home": "soft and comfortable for a day in",
    "active": "ready to move",
    "travel": "comfortable for a long day",
}
VIBE_REASONS = {
    "alluring": "fitted, a little daring, with confident lines",
    "romantic": "soft and romantic",
    "confident": "sharp and confident",
    "relaxed": "relaxed and easy",
    "bold": "bold, with a statement",
    "playful": "playful and light",
    "minimal": "clean and minimal",
    "elegant": "elegant and polished",
    "sporty": "sporty and ready to move",
}


# ── vocabulary ──────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def lexicon() -> dict[str, Any]:
    """The shared vocabulary: installed copy first, then the repository file."""
    here = Path(__file__).resolve().parent
    for path in (here / "lexicon.json", here.parents[1] / "packages" / "contracts" / "stylist-lexicon.json"):
        if path.is_file():
            return json.loads(path.read_text())
    raise FileNotFoundError("stylist-lexicon.json not found (packages/contracts)")


def _has(text: str, words: list[str]) -> bool:
    return any(re.search(rf"(?<![\w']){re.escape(w)}(?![\w'])", text) for w in words)


def _first(text: str, entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((e for e in entries if _has(text, e["words"])), None)


def is_evening_hour(hour: int | None) -> bool:
    lex = lexicon()
    return hour is not None and (hour >= lex["evening_from_hour"] or hour < lex["evening_until_hour"])


# ── items and intents ───────────────────────────────────────────────


@dataclass
class ItemView:
    id: str
    category: str
    subcategory: str | None = None
    color: str | None = None
    name: str | None = None
    #: Owner or detector tags, e.g. vibes ["romantic"], occasions ["office"].
    vibes: tuple[str, ...] = ()
    occasions: tuple[str, ...] = ()

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
    vibe: str | None = None
    cold: bool = False
    warm: bool = False
    #: The screen's local hour (0–23), if known.
    hour: int | None = None
    #: "evening" or "day" when the words (or the hour, for a mood-only request) decide it.
    time: str | None = None
    #: One clarifying question key ("day_or_night") or None.
    question: str | None = None


@dataclass
class Look:
    item_ids: list[str]
    score: float
    explanation: str
    title: str


def parse_intent(prompt: str, known_colors: set[str], hour: int | None = None) -> Intent:
    text = prompt.lower().replace("’", "'")
    lex = lexicon()
    occ = _first(text, lex["occasions"])
    vibe_entry = _first(text, lex["vibes"])
    occasion = occ["id"] if occ else None
    vibe = vibe_entry["id"] if vibe_entry else (occ or {}).get("vibe")

    time = "evening" if _has(text, lex["times"]["evening"]) else "day" if _has(text, lex["times"]["day"]) else None
    question = None
    if occasion is None and vibe is not None:
        # A mood with no occasion: the time of day decides, or we ask once.
        if time is None:
            if is_evening_hour(hour):
                time = "evening"
            elif re.search(r"\bday\b", text):
                time = "day"
        if time == "evening":
            occasion = "date" if vibe == "romantic" else "evening"
        elif time is None and vibe == "alluring":
            question = "day_or_night"
    elif occasion is None and time == "evening":
        occasion = "evening"

    colors = [c for c in sorted(known_colors | NEUTRALS | {"red", "blue", "green", "pink", "purple", "yellow", "orange", "burgundy", "emerald", "olive"}) if re.search(rf"\b{re.escape(c)}\b", text)]
    cats = [c for c in ("dress", "skirt", "top", "blouse", "shirt", "jacket", "blazer", "coat", "jeans", "trousers", "pants", "shorts", "shoes", "boots", "heels", "sneakers", "bag") if re.search(rf"\b{c}s?\b", text)]
    return Intent(raw=prompt, colors=colors, categories=cats, occasion=occasion, vibe=vibe,
                  cold=bool(re.search(COLD, text)), warm=bool(re.search(WARM, text)),
                  hour=hour, time=time, question=question)


QUESTIONS: dict[str, dict[str, Any]] = {
    "day_or_night": {
        "text": "Day or night?",
        "options": [{"label": "Daytime", "append": "daytime"}, {"label": "Tonight", "append": "tonight"}],
    },
}


def clarification(intent: Intent) -> dict[str, Any] | None:
    """The one question worth asking, with answers that carry the merged request."""
    q = QUESTIONS.get(intent.question or "")
    if not q:
        return None
    return {
        "id": intent.question,
        "text": q["text"],
        "options": [{"label": o["label"], "prompt": f"{intent.raw.strip()} {o['append']}"} for o in q["options"]],
    }


def offer(intent: Intent) -> dict[str, str] | None:
    """A follow-up the screen can offer after the looks (not a question)."""
    if intent.occasion == "shopping":
        return {"id": "gaps", "text": "Want me to list what your wardrobe is missing?", "label": "What am I missing?"}
    return None


# ── scoring ─────────────────────────────────────────────────────────


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
        if intent.occasion in item.occasions:
            s += 0.2
    if intent.vibe:
        good, colours, bad = VIBES[intent.vibe]
        if kinds & good:
            s += 0.25
        if item.color and item.color in colours:
            s += 0.15
        if kinds & bad:
            s -= 0.3
        if intent.vibe in item.vibes:
            s += 0.3
    return s


def _harmony(items: list[ItemView], intent: Intent) -> float:
    """Neutrals go with anything; more than one bold colour costs a little (unless bold was asked for)."""
    bold = {i.color for i in items if i.color and i.color not in NEUTRALS}
    if intent.vibe == "bold":
        return 0.1 if bold else 0.0
    return 0.1 if len(bold) <= 1 else -0.08 * (len(bold) - 1)


def _slots(items: list[ItemView]) -> dict[str, list[ItemView]]:
    slots: dict[str, list[ItemView]] = {k: [] for k in ("dress", "top", "bottom", "outerwear", "shoes", "extra")}
    for it in items:
        key = it.category if it.category in slots else ("extra" if it.category in ("bag", "accessory") else None)
        if key:
            slots[key].append(it)
    return slots


def _title(anchor: ItemView, intent: Intent) -> str:
    base = VIBE_TITLES.get(intent.vibe or "") or TITLES.get(intent.occasion or "", "Everyday")
    return f"{base} {anchor.subcategory or anchor.category}".strip().capitalize()


def explain(look_items: list[ItemView], intent: Intent) -> str:
    """Grounded: mentions only the chosen pieces, by their own names. Never the body."""
    anchor, rest = look_items[0], look_items[1:]
    parts = [f"The {anchor.label.lower()} leads"]
    if rest:
        names = [i.label.lower() for i in rest]
        parts.append("with the " + (", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else names[0]))
    reason = REASONS.get(intent.occasion or "") or VIBE_REASONS.get(intent.vibe or "", "balanced and wearable")
    if intent.occasion and intent.vibe and intent.vibe != _default_vibe(intent.occasion):
        mood, occ = VIBE_REASONS[intent.vibe], REASONS[intent.occasion]
        # "relaxed and easy" + "relaxed and easy", "sporty and ready to move" + "ready to move": say it once.
        reason = mood if occ in mood else f"{mood}, {occ}"
    if intent.cold and any(i.category == "outerwear" for i in look_items):
        reason += ", with a layer for the cold"
    return f"{' '.join(parts)} — {reason}."


def _default_vibe(occasion: str) -> str | None:
    return next((o.get("vibe") for o in lexicon()["occasions"] if o["id"] == occasion), None)


def build_looks(
    items: list[ItemView],
    intent: Intent,
    limit: int = 3,
    avoid_anchors: set[str] | None = None,
    must_include: str | None = None,
) -> list[Look]:
    """Up to `limit` complete outfits with different anchors, best first.

    `must_include` keeps only looks that wear that piece (e.g. one just added).
    """
    slots = _slots(items)
    score = {i.id: _item_score(i, intent) for i in items}
    top = lambda slot, n=3: sorted(slots[slot], key=lambda i: score[i.id], reverse=True)[:n]
    pinned = next((i for i in items if i.id == must_include), None)

    def ranked(slot: str, n: int) -> list[ItemView]:
        best = top(slot, n)
        if pinned and slot == _slot_of(pinned) and pinned not in best:
            best = [pinned, *best[: n - 1]]
        return best

    bases: list[list[ItemView]] = [[d] for d in ranked("dress", 4)]
    bases += [[t, b] for t, b in itertools.product(ranked("top", 3), ranked("bottom", 3))]
    looks: list[tuple[float, list[ItemView]]] = []
    for base in bases:
        look = list(base)
        want_layer = intent.cold or intent.occasion in ("office", "interview", "evening", "date")
        if slots["outerwear"] and (want_layer or (pinned and _slot_of(pinned) == "outerwear")):
            look.append(pinned if pinned and _slot_of(pinned) == "outerwear" else top("outerwear", 1)[0])
        if slots["shoes"] and intent.occasion != "home":
            look.append(pinned if pinned and _slot_of(pinned) == "shoes" else top("shoes", 1)[0])
        wants_bag = intent.occasion in ("evening", "date", "shopping") or (
            intent.vibe in ("alluring", "elegant") and intent.time != "day"  # a clutch is for the evening
        )
        if slots["extra"] and (wants_bag or (pinned and _slot_of(pinned) == "extra")):
            look.append(pinned if pinned and _slot_of(pinned) == "extra" else top("extra", 1)[0])
        if pinned and pinned not in look:
            continue
        total = sum(score[i.id] for i in look) / len(look) + _harmony(look, intent)
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


def _slot_of(item: ItemView) -> str | None:
    if item.category in ("dress", "top", "bottom", "outerwear", "shoes"):
        return item.category
    return "extra" if item.category in ("bag", "accessory") else None


def pairing_line(new: ItemView, look: Look, items: list[ItemView]) -> str:
    """One spoken line after a piece is added: name it and one owned partner."""
    names = {i.id: i.label.lower() for i in items}
    partners = [names[i] for i in look.item_ids if i != new.id and i in names]
    noun = _spoken_name(new)
    if not partners:
        return f"Nice, your new {noun} is in your wardrobe."
    return f"Nice, your new {noun}. It works with your {partners[0]}; want to see the whole look?"


def _spoken_name(item: ItemView) -> str:
    """"navy skirt", or "navy piece" when only a broad category is known ("bottom" is not how people talk)."""
    if item.name:
        return item.name.lower()
    noun = item.subcategory or (item.category if item.category not in ("top", "bottom", "outerwear", "accessory") else "piece")
    return " ".join(p for p in (item.color, noun) if p)


def gaps(items: list[ItemView], intent: Intent) -> list[dict[str, str]]:
    """Slots the wardrobe cannot fill for this request — what to shop for."""
    slots = _slots(items)
    out: list[dict[str, str]] = []
    if not slots["dress"] and not (slots["top"] and slots["bottom"]):
        missing = "top" if not slots["top"] else "bottom"
        out.append({"slot": missing, "category": missing})
    if not slots["shoes"] and intent.occasion != "home":
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
