"""Grok Imagine payloads for OllaBridge Cloud image edit.

SmartMirror owns the fashion meaning (who, which garment, the words).
OllaBridge Cloud owns transport and the xAI call. These builders speak the
cloud job, not ``api.x.ai``: the cloud maps ``image`` + ``references`` onto
Grok Imagine's ``images`` array (stills) or ``reference_images`` (a haul clip).

xAI ``grok-imagine-image-2.0`` accepts at most five sources. Image 1 is the
person, so a still carries at most four garment photos. A haul is several
stills, each edited from the original capture, so identity does not drift.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass

from .base import ReferenceImage
from .homepilot_node import ProviderError

GROK_IMAGE_MODEL = "grok-imagine-image-2.0"
GROK_VIDEO_MODEL = "grok-imagine-video-1.5"
LEGACY_EDIT_MODEL = "edit-default"
# Five sources total on an image edit; the person occupies the first.
MAX_GARMENTS = 4
# Each haul frame is its own edit. Eight stills is the cost ceiling here.
MAX_HAUL_FRAMES = 8
# grok-imagine-video-1.5 allows up to 15s. A haul clip stays short.
MIN_CLIP_S = 2
MAX_CLIP_S = 10
DEFAULT_CLIP_S = 6
_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


@dataclass
class HaulFrame:
    """One Amazon (or wardrobe) garment to show on the original photo."""

    garment: ReferenceImage
    slot: str = ""


def resolve_edit_model(configured: str, *, has_references: bool) -> str:
    """Text-only edits keep today's model. Garment pixels select Grok Imagine."""
    chosen = (configured or LEGACY_EDIT_MODEL).strip()
    if has_references and chosen == LEGACY_EDIT_MODEL:
        return GROK_IMAGE_MODEL
    return chosen


def cloud_edit_body(
    *,
    person: bytes,
    person_type: str,
    prompt: str,
    references: list[ReferenceImage] | None = None,
    model: str = LEGACY_EDIT_MODEL,
) -> dict:
    """Body for ``POST /v1/images/edits``. Omit ``references`` when there are none."""
    refs = list(references or [])
    if len(refs) > MAX_GARMENTS:
        raise ProviderError(
            f"RESOURCE_REJECTED: at most {MAX_GARMENTS} garment images (Grok Imagine allows 5 sources)"
        )
    body: dict = {
        "model": resolve_edit_model(model, has_references=bool(refs)),
        "prompt": prompt,
        "image": _part(person, person_type),
    }
    if refs:
        body["references"] = [_part(ref.data, ref.content_type) for ref in refs]
    return body


def cloud_video_body(
    *,
    person: bytes,
    person_type: str,
    garment: ReferenceImage,
    prompt: str,
    duration: int = DEFAULT_CLIP_S,
    model: str = GROK_VIDEO_MODEL,
) -> dict:
    """Body for ``POST /v1/videos/generations`` — one person, one garment, a short clip."""
    if duration < MIN_CLIP_S or duration > MAX_CLIP_S:
        raise ProviderError(
            f"RESOURCE_REJECTED: a haul clip is {MIN_CLIP_S} to {MAX_CLIP_S} seconds"
        )
    return {
        "model": model,
        "prompt": prompt,
        "duration": duration,
        "image": _part(person, person_type),
        "references": [_part(garment.data, garment.content_type)],
    }


def haul_edit_bodies(
    *,
    person: bytes,
    person_type: str,
    frames: list[HaulFrame],
    model: str = GROK_IMAGE_MODEL,
) -> list[dict]:
    """One still per garment, each anchored on the original person photo."""
    if not frames:
        raise ProviderError("RESOURCE_REJECTED: a haul needs at least one garment image")
    if len(frames) > MAX_HAUL_FRAMES:
        raise ProviderError(f"RESOURCE_REJECTED: a haul shows at most {MAX_HAUL_FRAMES} garments")
    return [
        cloud_edit_body(
            person=person,
            person_type=person_type,
            prompt=swap_prompt([frame.garment], slot=frame.slot),
            references=[frame.garment],
            model=model,
        )
        for frame in frames
    ]


def swap_prompt(
    references: list[ReferenceImage],
    *,
    also: list[str] | None = None,
    slot: str = "",
    extra: str = "",
) -> str:
    """Identity-locked clothing swap. Image 1 is the person; references follow."""
    shown = "; ".join(
        f"image {index + 2} ({_clip(ref.label, 120) or 'a garment'})"
        for index, ref in enumerate(references)
    )
    if not shown:
        shown = "the selected outfit"
    text = (
        "Image 1 is a real person. Keep their face, hair, skin tone, body shape, pose, "
        "camera angle and background identical. "
        f"Change their clothes to the garments in {shown}. "
        "Match each shown garment's color, pattern, logos and fabric. "
    )
    slot_name = _clip(slot, 40)
    if slot_name and len(references) == 1:
        text += f"Replace only the {slot_name}. Leave every other garment they are already wearing unchanged. "
    others = [_clip(name, 120) for name in (also or []) if _clip(name, 120)]
    if others:
        text += "Also dress them in: " + "; ".join(others) + ". "
    text += "Do not add people, text or accessories that are not described. Photorealistic, natural fabric and fit."
    note = extra.strip()
    if note:
        text += " " + note[:300]
    return text


def haul_clip_prompt(label: str, *, slot: str = "") -> str:
    slot_name = _clip(slot, 40)
    replace = f" Replace only the {slot_name}." if slot_name else ""
    return (
        "The person in image 1 turns slightly in place and is now wearing the garment in image 2 "
        f"({_clip(label, 120) or 'the garment'}).{replace} "
        "Keep their face, hair, body and the room the same. Natural movement, no extra people, no on-screen text."
    )


def _part(data: bytes, content_type: str) -> dict[str, str]:
    kind = (content_type or "").split(";", 1)[0].strip().lower()
    if kind not in _ALLOWED_TYPES:
        raise ProviderError("RESOURCE_REJECTED: images must be JPEG, PNG or WebP")
    if not data:
        raise ProviderError("RESOURCE_REJECTED: image is empty")
    return {"b64": base64.b64encode(data).decode("ascii"), "content_type": kind}


def _clip(value: str, limit: int) -> str:
    return " ".join((value or "").split())[:limit]
