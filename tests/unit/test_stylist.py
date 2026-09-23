from smartmirror.stylist.service import normalize_intent


def test_normalize_intent_extracts_basic_style():
    result = normalize_intent("Sexy black mini skirt outfit for dinner")
    assert "black" in result["colors"]
    assert "skirt" in result["categories"]
    assert "sexy" in result["styles"]
