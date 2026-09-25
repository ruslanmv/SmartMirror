"""Dominant garment colour, named, from a photo (no ML needed)."""
from __future__ import annotations

import io
import math

from PIL import Image, ImageOps

# Named colours a wardrobe uses (sRGB). Kept short so names are predictable.
PALETTE: dict[str, tuple[int, int, int]] = {
    "black": (20, 20, 22),
    "charcoal": (64, 64, 68),
    "grey": (140, 140, 145),
    "white": (245, 245, 242),
    "ivory": (236, 228, 208),
    "beige": (205, 185, 150),
    "camel": (180, 135, 85),
    "brown": (110, 70, 40),
    "navy": (30, 40, 80),
    "blue": (50, 100, 190),
    "light blue": (150, 190, 230),
    "green": (50, 130, 70),
    "olive": (110, 110, 50),
    "emerald": (20, 120, 90),
    "red": (190, 30, 40),
    "burgundy": (110, 25, 45),
    "pink": (230, 150, 175),
    "purple": (110, 60, 140),
    "yellow": (235, 205, 60),
    "orange": (230, 120, 40),
    "gold": (200, 160, 60),
    "silver": (190, 190, 195),
}


def _lab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    def lin(c: float) -> float:
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(c) for c in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


_PALETTE_LAB = {name: _lab(rgb) for name, rgb in PALETTE.items()}


def name_color(rgb: tuple[float, float, float]) -> tuple[str, float]:
    """Nearest named colour and a 0..1 confidence from the LAB distance."""
    lab = _lab(rgb)
    ranked = sorted((math.dist(lab, ref), name) for name, ref in _PALETTE_LAB.items())
    (d1, best), (d2, _) = ranked[0], ranked[1]
    closeness = max(0.0, 1 - d1 / 40)
    separation = min(1.0, (d2 - d1) / 12)
    return best, round(0.6 * closeness + 0.4 * separation, 3)


def analyze(data: bytes) -> dict:
    """Dominant colour (garment, not background) and solid vs patterned."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    img.thumbnail((96, 96))
    w, h = img.size
    px = img.load()
    border = [px[x, y] for x in range(w) for y in (0, h - 1)] + [px[x, y] for y in range(h) for x in (0, w - 1)]
    bg = tuple(sum(c[i] for c in border) / len(border) for i in range(3))
    garment = [px[x, y] for y in range(h) for x in range(w) if math.dist(px[x, y], bg) > 40]
    if len(garment) < w * h * 0.05:  # nothing stands out from the border: use the centre
        garment = [px[x, y] for y in range(h // 4, 3 * h // 4) for x in range(w // 4, 3 * w // 4)]

    # Group garment pixels by their named colour; the largest group wins.
    sample = garment[:: max(1, len(garment) // 2500)]
    groups: dict[str, list[tuple[int, int, int]]] = {}
    for p in sample:
        groups.setdefault(name_color(p)[0], []).append(p)
    ranked = sorted(groups.items(), key=lambda kv: len(kv[1]), reverse=True)
    _, top_px = ranked[0]
    share = len(top_px) / len(sample)
    second = ranked[1] if len(ranked) > 1 and len(ranked[1][1]) / len(sample) > 0.2 else None
    mean = tuple(sum(c[i] for c in top_px) / len(top_px) for i in range(3))
    name, conf = name_color(mean)
    pattern = "solid" if share >= 0.6 else "patterned"
    return {
        "color": name,
        "color_confidence": round(conf * (0.5 + 0.5 * min(1.0, share / 0.6)), 3),
        "secondary_color": second[0] if second else None,
        "pattern": pattern,
        "pattern_confidence": round(abs(share - 0.6) / 0.4, 3) if share < 1 else 1.0,
        "rgb": [round(c) for c in mean],
    }
