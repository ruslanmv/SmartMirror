from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TryOnRequest:
    person_image: bytes
    person_content_type: str
    garment_refs: list[str] = field(default_factory=list)
    instruction: str = ""
    preserve_identity: bool = True


@dataclass
class TryOnResult:
    image_urls: list[str] = field(default_factory=list)
    provider: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


class VirtualTryOnProvider(abc.ABC):
    name: str = "base"

    @abc.abstractmethod
    async def generate(self, request: TryOnRequest) -> TryOnResult:
        raise NotImplementedError
