import pytest
from fastapi.testclient import TestClient

from services.api.app.config import get_settings
from services.api.app.main import app
from smartmirror.stylist.engine import ItemView, build_looks, gaps, parse_intent, plan_set

W = [
    ItemView("d1", "dress", "slip dress", "black", "Black silk slip dress"),
    ItemView("t1", "top", "blouse", "ivory", "Ivory blouse"),
    ItemView("t2", "top", "t-shirt", "white", "White tee"),
    ItemView("b1", "bottom", "trousers", "navy", "Navy trousers"),
    ItemView("b2", "bottom", "jeans", "blue", "Blue jeans"),
    ItemView("o1", "outerwear", "blazer", "charcoal", "Charcoal blazer"),
    ItemView("s1", "shoes", "heels", "black", "Black heels"),
    ItemView("s2", "shoes", "sneakers", "white", "White sneakers"),
    ItemView("x1", "bag", "handbag", "gold", "Gold clutch"),
]
NAMES = {i.id: i.name for i in W}


def looks(prompt, items=W, limit=3):
    return build_looks(items, parse_intent(prompt, set()), limit=limit)


def test_dinner_is_polished_and_complete():
    top = looks("dinner date tonight")[0]
    assert top.item_ids[0] == "d1"
    assert {"s1", "o1", "x1"} <= set(top.item_ids)
    assert "polished for the evening" in top.explanation


def test_office_prefers_tailoring():
    top = looks("meeting at the office")[0]
    assert {"b1", "o1"} <= set(top.item_ids)
    assert "s2" not in top.item_ids or "s1" not in top.item_ids


def test_weekend_avoids_heels_and_blazer():
    top = looks("relaxed weekend brunch")[0]
    assert "s2" in top.item_ids and "s1" not in top.item_ids
    assert "o1" not in top.item_ids


def test_explanations_only_cite_chosen_pieces():
    for look in looks("dinner", limit=3) + looks("office", limit=3):
        mentioned = {i for i, n in NAMES.items() if n.lower() in look.explanation}
        assert mentioned == set(look.item_ids), (look.explanation, look.item_ids)


def test_distinct_anchors_and_cold_layers():
    result = looks("chilly day out", limit=3)
    anchors = [r.item_ids[0] for r in result]
    assert len(anchors) == len(set(anchors)) == 3
    assert all("o1" in r.item_ids for r in result)


def test_gaps_name_what_is_missing():
    no_shoes = [i for i in W if i.category != "shoes"]
    assert {"slot": "shoes", "category": "shoes", "query": "shoes"} in gaps(no_shoes, parse_intent("dinner", set()))
    no_coat = [i for i in W if i.category != "outerwear"]
    cold = gaps(no_coat, parse_intent("black look for a cold evening", set()))
    assert any(g["category"] == "outerwear" and g["query"] == "black outerwear" for g in cold)
    assert gaps(W, parse_intent("dinner", set())) == []


def test_week_plan_rotates_before_repeating():
    week = plan_set(W, parse_intent("office", set()), 5)
    assert len(week) == 5
    first_three = [lk.item_ids[0] for lk in week[:3]]
    assert len(set(first_three)) == 3
    assert plan_set([], parse_intent("office", set()), 5) == []


# ── tools ───────────────────────────────────────────────────────────


def call(client, name, args):
    return client.post("/rpc", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}})


def ok(r):
    assert r.status_code == 200, r.text
    return r.json()["result"]["structuredContent"]


@pytest.fixture
def client():
    c = TestClient(app)
    for it in W:
        ok(call(c, "hp.smartmirror.wardrobe_add", {"profile_id": "p-v2", "category": it.category, "subcategory": it.subcategory,
                                                   "color": it.color, "metadata": {"name": it.name}}))
    return c


def test_style_suggest_returns_titles_and_gaps(client):
    out = ok(call(client, "hp.smartmirror.style_suggest", {"profile_id": "p-v2", "prompt": "dinner date"}))
    assert out["outfits"][0]["title"] and out["gaps"] == []
    assert out["normalized_intent"]["occasion"] == "evening"


def test_sets_create_list_delete(client):
    week = ok(call(client, "hp.smartmirror.set_create", {"profile_id": "p-v2", "kind": "week", "days": 5}))
    assert [lk["label"] for lk in week["looks"]] == ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    trip = ok(call(client, "hp.smartmirror.set_create", {"profile_id": "p-v2", "kind": "trip", "days": 3, "prompt": "city trip, chilly"}))
    assert trip["looks"][0]["label"] == "Day 1"
    listed = ok(call(client, "hp.smartmirror.set_list", {"profile_id": "p-v2"}))
    assert [s["id"] for s in listed][:2] == [trip["id"], week["id"]]
    ok(call(client, "hp.smartmirror.set_delete", {"profile_id": "p-v2", "set_id": week["id"]}))
    assert week["id"] not in [s["id"] for s in ok(call(client, "hp.smartmirror.set_list", {"profile_id": "p-v2"}))]
    assert call(client, "hp.smartmirror.set_create", {"profile_id": "nobody", "kind": "week"}).status_code == 400


def test_shopping_is_off_by_default_then_links_out(client, monkeypatch):
    r = call(client, "hp.smartmirror.shop_suggest", {"profile_id": "p-v2", "category": "boots"})
    assert r.status_code == 400 and "CAPABILITY_UNAVAILABLE" in r.text

    s = get_settings()
    monkeypatch.setattr(s, "smartmirror_shopping", "linkout")
    monkeypatch.setattr(s, "amazon_partner_tag", "mirror-21")
    (offer,) = ok(call(client, "hp.smartmirror.shop_suggest", {"profile_id": "p-v2", "category": "boots", "color": "black"}))
    assert offer["url"] == "https://www.amazon.com/s?k=black+boots&tag=mirror-21"
    bought = ok(call(client, "hp.smartmirror.shop_mark_purchased", {"profile_id": "p-v2", "candidate_id": offer["id"]}))
    assert bought["purchased"] is True
