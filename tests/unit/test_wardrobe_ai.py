import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from services.api.app.database import SessionLocal
from services.api.app.main import app
from services.api.app.models import Asset, ClassificationRun
from smartmirror.ml.classifier import (
    BaselineClassifier,
    ZeroShotClassifier,
    needs_review,
    set_classifier,
)
from smartmirror.ml.labels import prompt
from smartmirror.storage import LocalMediaStore, set_store


def garment(color=(25, 35, 85), bg=(245, 245, 245), stripes=None) -> bytes:
    img = Image.new("RGB", (300, 400), bg)
    d = ImageDraw.Draw(img)
    d.rectangle((70, 60, 230, 360), fill=color)
    if stripes:
        for y in range(60, 360, 24):
            d.rectangle((70, y, 230, y + 11), fill=stripes)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=92)
    return out.getvalue()


def data_url(b: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(b).decode()


@pytest.fixture
def store(tmp_path):
    s = LocalMediaStore(tmp_path / "media")
    set_store(s)
    set_classifier(BaselineClassifier())
    yield s
    set_store(None)
    set_classifier(None)


def call(client, name, args):
    r = client.post("/rpc", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}})
    return r


def result(r):
    assert r.status_code == 200, r.text
    return r.json()["result"]["structuredContent"]


# ── classifiers ─────────────────────────────────────────────────────


@pytest.mark.parametrize("rgb,name", [((25, 35, 85), "navy"), ((190, 30, 40), "red"), ((20, 20, 22), "black"), ((205, 185, 150), "beige")])
def test_baseline_names_the_garment_colour_not_the_background(rgb, name):
    c = BaselineClassifier().classify(garment(rgb))
    assert c.color.value == name and c.color.confidence >= 0.6
    assert c.pattern.value == "solid"
    assert c.category.value is None and needs_review(c.category)


def test_baseline_spots_patterns():
    c = BaselineClassifier().classify(garment((25, 35, 85), stripes=(245, 245, 240)))
    assert c.pattern.value == "patterned"


def test_zero_shot_maps_subcategories_to_categories():
    def fake_pipeline(image, candidate_labels):
        scores = {prompt("jeans"): 0.55, prompt("trousers"): 0.25, prompt("skirt"): 0.1}
        return [{"label": lbl, "score": scores.get(lbl, 0.1 / len(candidate_labels))} for lbl in candidate_labels]

    c = ZeroShotClassifier("fake/model", pipeline=fake_pipeline).classify(garment())
    assert c.subcategory.value == "jeans" and c.category.value == "bottom"
    assert c.category.confidence > 0.85 and not needs_review(c.category, c.extra["category_margin"])
    # 0.55 is below the 0.6 bar: the category is sure, the exact subcategory goes to review
    assert needs_review(c.subcategory, c.extra["subcategory_margin"]) is True
    assert c.color.value == "navy"  # colour still comes from the baseline


# ── add clothes: ingest → review → confirm ─────────────────────────


def test_ingest_review_confirm_flow(store):
    client = TestClient(app)
    base = {"profile_id": "p-closet"}
    added = result(call(client, "hp.smartmirror.wardrobe_ingest", {**base, "image": data_url(garment())}))
    assert added["status"] == "draft" and added["color"] == "navy"
    assert "category" in added["ai"]["needs_review"]

    # the same photo again does not create a second item
    again = result(call(client, "hp.smartmirror.wardrobe_ingest", {**base, "image": data_url(garment())}))
    assert again["id"] == added["id"]

    # drafts are not in the wardrobe (or the stylist) until confirmed
    assert result(call(client, "hp.smartmirror.wardrobe_list", base)) == []
    assert len(result(call(client, "hp.smartmirror.wardrobe_list", {**base, "include_drafts": True}))) == 1

    queue = result(call(client, "hp.smartmirror.wardrobe_review", base))
    (draft,) = queue
    assert draft["image_url"].startswith("data:image/jpeg;base64,")
    assert draft["suggested"]["color"] == "navy" and "bottom" in draft["categories"]

    # can't confirm without a category; one press (subcategory) is enough
    assert call(client, "hp.smartmirror.wardrobe_confirm", {**base, "item_id": draft["id"]}).status_code == 400
    confirmed = result(call(client, "hp.smartmirror.wardrobe_confirm",
                            {**base, "item_id": draft["id"], "subcategory": "jeans", "name": "Dark jeans"}))
    assert confirmed["status"] == "confirmed" and confirmed["category"] == "bottom"

    (listed,) = result(call(client, "hp.smartmirror.wardrobe_list", base))
    assert listed["metadata"]["name"] == "Dark jeans"
    assert listed["metadata"]["image_url"].startswith("data:image/jpeg;base64,")
    assert result(call(client, "hp.smartmirror.wardrobe_review", base)) == []

    with SessionLocal() as db:
        run = db.query(ClassificationRun).filter_by(item_id=draft["id"]).one()
        assert run.model_id == "smartmirror/baseline-color"

    # the stylist now uses it — once there is something to wear on top
    alone = result(call(client, "hp.smartmirror.style_suggest", {**base, "prompt": "jeans for the weekend"}))
    assert alone["outfits"] == [] and alone["gaps"][0]["category"] == "top"
    result(call(client, "hp.smartmirror.wardrobe_add", {**base, "category": "top", "subcategory": "t-shirt", "color": "white"}))
    suggestion = result(call(client, "hp.smartmirror.style_suggest", {**base, "prompt": "jeans for the weekend"}))
    assert any(draft["id"] in o["item_ids"] for o in suggestion["outfits"])

    # removing it deletes the photo too
    asset_id = None
    with SessionLocal() as db:
        from services.api.app.models import WardrobeItem

        asset_id = db.get(WardrobeItem, draft["id"]).image_asset_id
    result(call(client, "hp.smartmirror.wardrobe_remove", {**base, "item_id": draft["id"]}))
    with SessionLocal() as db:
        assert db.get(Asset, asset_id) is None


def test_confirm_is_scoped_to_the_profile(store):
    client = TestClient(app)
    added = result(call(client, "hp.smartmirror.wardrobe_ingest", {"profile_id": "p-a", "image": data_url(garment((190, 30, 40)))}))
    r = call(client, "hp.smartmirror.wardrobe_confirm", {"profile_id": "p-b", "item_id": added["id"], "category": "top"})
    assert r.status_code == 400
