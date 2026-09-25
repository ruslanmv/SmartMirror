from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class WardrobeItemCreate(BaseModel):
    profile_id: str = "local-user"
    category: str
    subcategory: str | None = None
    color: str | None = None
    material: str | None = None
    fit: str | None = None
    length: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class WardrobeItemOut(WardrobeItemCreate):
    id: str


class StyleSuggestIn(BaseModel):
    profile_id: str = "local-user"
    prompt: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=3, ge=1, le=8)


class OutfitCandidate(BaseModel):
    id: str
    item_ids: list[str]
    score: float
    explanation: str
    title: str | None = None


class StyleSuggestOut(BaseModel):
    request_id: str
    normalized_intent: dict[str, Any]
    outfits: list[OutfitCandidate]


class TryOnCreateIn(BaseModel):
    profile_id: str = "local-user"
    outfit_id: str
    body_capture_ref: str
    instruction: str = ""


class JobOut(BaseModel):
    id: str
    status: str
    progress: float
    result: dict[str, Any] = Field(default_factory=dict)
    error_code: str | None = None
