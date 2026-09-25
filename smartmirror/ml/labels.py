"""Garment vocabulary for zero-shot classification: subcategory -> category."""
from __future__ import annotations

SUBCATEGORIES: dict[str, str] = {
    "dress": "dress",
    "slip dress": "dress",
    "t-shirt": "top",
    "shirt": "top",
    "blouse": "top",
    "sweater": "top",
    "hoodie": "top",
    "tank top": "top",
    "blazer": "outerwear",
    "jacket": "outerwear",
    "coat": "outerwear",
    "trousers": "bottom",
    "jeans": "bottom",
    "skirt": "bottom",
    "shorts": "bottom",
    "heels": "shoes",
    "sneakers": "shoes",
    "boots": "shoes",
    "sandals": "shoes",
    "handbag": "bag",
    "scarf": "accessory",
    "belt": "accessory",
    "hat": "accessory",
}

CATEGORIES = sorted(set(SUBCATEGORIES.values()))


def prompt(label: str) -> str:
    return f"a product photo of {'an' if label[0] in 'aeiou' else 'a'} {label}"
