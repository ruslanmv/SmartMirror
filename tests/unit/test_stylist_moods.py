"""Stylist upgrade: occasion × vibe, the day, one question, new pieces
(docs/ux/stylist-conversation-review.md §4)."""
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from services.api.app.main import app
from smartmirror.stylist.engine import ItemView, build_looks, explain, pairing_line, parse_intent

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((ROOT / "packages/contracts/stylist-intents.json").read_text())["cases"]

W = [
    ItemView("d1", "dress", "slip dress", "black", "Black silk slip dress"),
    ItemView("t1", "top", "blouse", "ivory", "Ivory blouse"),
    ItemView("t2", "top", "t-shirt", "white", "White tee"),
    ItemView("t3", "top", "sweater", "camel", "Camel knit"),
    ItemView("b1", "bottom", "trousers", "navy", "Navy trousers"),
    ItemView("b2", "bottom", "jeans", "blue", "Blue jeans"),
    ItemView("b3", "bottom", "skirt", "red", "Red midi skirt"),
    ItemView("o1", "outerwear", "blazer", "charcoal", "Charcoal blazer"),
    ItemView("s1", "shoes", "heels", "black", "Black heels"),
    ItemView("s2", "shoes", "sneakers", "white", "White sneakers"),
    ItemView("x1", "bag", "handbag", "gold", "Gold clutch"),
]


def top_look(prompt, hour=None, items=W):
    looks = build_looks(items, parse_intent(prompt, set(), hour=hour), limit=3)
    return looks[0], set(looks[0].item_ids)


@pytest.mark.parametrize("case", CASES, ids=[f"{c['prompt']}@{c['hour']}" for c in CASES])
def test_shared_intent_table(case):
    i = parse_intent(case["prompt"], set(), hour=case["hour"])
    assert (i.occasion, i.vibe, i.question) == (case["occasion"], case["vibe"], case["question"])


def test_love_day_is_a_romantic_date():
    look, ids = top_look("love day", hour=10)
    assert look.title.startswith("Romantic")
    assert ids & {"d1", "t1", "b3"} and "s1" in ids and "s2" not in ids
    assert "romantic" in look.explanation


def test_sexy_tonight_is_an_alluring_evening_and_never_about_the_body():
    look, ids = top_look("sexy day", hour=20)
    assert look.title.startswith("Sultry") and "d1" in ids and "s1" in ids and "x1" in ids
    for prompt in ("sexy day", "something sexy tonight", "hot date", "flirty brunch"):
        for lk in build_looks(W, parse_intent(prompt, set(), hour=20), limit=3):
            assert not re.search(r"\b(body|figure|curves|legs|skin|weight|slim|sexy)\b", lk.explanation)


def test_sexy_in_the_morning_is_daywear():
    _, ids = top_look("sexy day", hour=9)
    assert "x1" not in ids  # no evening bag by day


def test_work_day_is_tailored_with_a_layer():
    _, ids = top_look("work day", hour=8)
    assert {"b1", "o1"} <= ids and "s2" not in ids


def test_shopping_day_is_walkable_and_offers_gaps():
    _, ids = top_look("shopping day", hour=11)
    assert "s2" in ids and "s1" not in ids


def test_lazy_day_is_soft_with_no_heels_or_blazer():
    _, ids = top_look("lazy day", hour=11)
    assert not ids & {"s1", "s2", "o1", "d1"} and ids & {"t3", "t2"}


def test_bold_mood_prefers_colour():
    _, ids = top_look("bold party look", hour=21)
    assert "b3" in ids


def test_item_tags_steer_the_look():
    tagged = [*W, ItemView("d2", "dress", "wrap dress", "green", "Green wrap dress", vibes=("romantic",), occasions=("date",))]
    _, ids = top_look("love day", hour=19, items=tagged)
    assert "d2" in ids


def test_anchor_keeps_the_new_piece_and_says_one_line():
    new = next(i for i in W if i.id == "b3")
    looks = build_looks(W, parse_intent("everyday", set(), hour=10), limit=3, must_include="b3")
    assert looks and all("b3" in lk.item_ids for lk in looks)
    line = pairing_line(new, looks[0], W)
    assert line.startswith("Nice, your new red midi skirt.") and "want to see the whole look?" in line
    unnamed = ItemView("n1", "bottom", None, "navy")
    assert pairing_line(unnamed, looks[0], [*W, unnamed]).startswith("Nice, your new navy piece.")


def test_explanations_say_occasion_and_mood_once():
    i = parse_intent("relaxed weekend brunch", set(), hour=11)
    text = explain([W[2], W[5]], i)
    assert text.count("relaxed") == 1


# ── through the tool ────────────────────────────────────────────────


def call(client, args):
    r = client.post("/rpc", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                  "params": {"name": "hp.smartmirror.style_suggest", "arguments": args}})
    assert r.status_code == 200, r.text
    return r.json()["result"]["structuredContent"]


@pytest.fixture(scope="module")
def client():
    c = TestClient(app)
    for it in W:
        c.post("/rpc", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
            "name": "hp.smartmirror.wardrobe_add",
            "arguments": {"profile_id": "p-moods", "category": it.category, "subcategory": it.subcategory,
                          "color": it.color, "metadata": {"name": it.name}}}})
    return c


def test_tool_asks_day_or_night_with_merged_answers(client):
    out = call(client, {"profile_id": "p-moods", "prompt": "something sexy", "context": {"hour": 10}})
    q = out["question"]
    assert q["text"] == "Day or night?"
    assert [o["prompt"] for o in q["options"]] == ["something sexy daytime", "something sexy tonight"]
    assert out["outfits"], "a best guess is shown under the question"
    answered = call(client, {"profile_id": "p-moods", "prompt": q["options"][1]["prompt"], "context": {"hour": 10}})
    assert answered["question"] is None
    assert (answered["normalized_intent"]["occasion"], answered["normalized_intent"]["vibe"]) == ("evening", "alluring")


def test_tool_uses_the_screen_hour_and_offers_gaps_for_shopping(client):
    night = call(client, {"profile_id": "p-moods", "prompt": "something sexy", "context": {"hour": 21}})
    assert night["question"] is None and night["normalized_intent"]["occasion"] == "evening"
    shop = call(client, {"profile_id": "p-moods", "prompt": "shopping day", "context": {"hour": "nonsense"}})
    assert shop["offer"]["id"] == "gaps"


def test_tool_anchor_returns_a_pairing_line(client):
    items = client.post("/rpc", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
        "name": "hp.smartmirror.wardrobe_list", "arguments": {"profile_id": "p-moods"}}}).json()["result"]["structuredContent"]
    skirt = next(i for i in items if i["subcategory"] == "skirt")
    assert skirt["created_at"]
    out = call(client, {"profile_id": "p-moods", "prompt": "everyday", "anchor_id": skirt["id"]})
    assert all(skirt["id"] in o["item_ids"] for o in out["outfits"])
    assert out["pairing_line"].startswith("Nice, your new red midi skirt.")
