from __future__ import annotations

import io
import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol

from . import colors, labels

log = logging.getLogger("smartmirror.ml")

# A field is accepted without review only above this confidence and margin.
ACCEPT_CONFIDENCE = 0.6
ACCEPT_MARGIN = 0.15


@dataclass
class FieldGuess:
    value: str | None
    confidence: float
    alternatives: list[str] = field(default_factory=list)


@dataclass
class Classification:
    category: FieldGuess
    subcategory: FieldGuess
    color: FieldGuess
    pattern: FieldGuess
    model_id: str
    model_version: str
    duration_ms: int = 0
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def needs_review(guess: FieldGuess, margin: float | None = None) -> bool:
    if guess.value is None:
        return True
    if guess.confidence < ACCEPT_CONFIDENCE:
        return True
    return margin is not None and margin < ACCEPT_MARGIN


class Classifier(Protocol):
    model_id: str
    model_version: str

    def classify(self, data: bytes) -> Classification: ...


class BaselineClassifier:
    """Colour and pattern only; the owner picks the category (one press)."""

    model_id = "smartmirror/baseline-color"
    model_version = "1"

    def classify(self, data: bytes) -> Classification:
        started = time.perf_counter()
        c = colors.analyze(data)
        return Classification(
            category=FieldGuess(None, 0.0, list(labels.CATEGORIES)),
            subcategory=FieldGuess(None, 0.0),
            color=FieldGuess(c["color"], c["color_confidence"], [c["secondary_color"]] if c["secondary_color"] else []),
            pattern=FieldGuess(c["pattern"], c["pattern_confidence"]),
            model_id=self.model_id,
            model_version=self.model_version,
            duration_ms=int((time.perf_counter() - started) * 1000),
            extra={"rgb": c["rgb"]},
        )


class ZeroShotClassifier:
    """Zero-shot fashion model via transformers (optional `[ml]` extra).

    Default model: FashionCLIP (patrickjohncyh/fashion-clip). Any CLIP/SigLIP
    model supported by the transformers zero-shot-image-classification
    pipeline works. Runs on CUDA when available.
    """

    def __init__(self, model_id: str, device: str = "auto", pipeline: Any = None):
        self.model_id = model_id
        self.model_version = "hf"
        self._device = device
        self._pipe = pipeline
        self._baseline = BaselineClassifier()

    def _pipeline(self) -> Any:
        if self._pipe is None:
            from transformers import pipeline  # optional dependency

            device = self._device
            if device == "auto":
                try:
                    import torch

                    device = "cuda" if torch.cuda.is_available() else "cpu"
                except ImportError:
                    device = "cpu"
            self._pipe = pipeline("zero-shot-image-classification", model=self.model_id, device=device)
        return self._pipe

    def classify(self, data: bytes) -> Classification:
        from PIL import Image

        started = time.perf_counter()
        base = self._baseline.classify(data)
        image = Image.open(io.BytesIO(data)).convert("RGB")
        subs = list(labels.SUBCATEGORIES)
        scores = self._pipeline()(image, candidate_labels=[labels.prompt(s) for s in subs])
        by_label = {r["label"]: float(r["score"]) for r in scores}
        ranked = sorted(((by_label.get(labels.prompt(s), 0.0), s) for s in subs), reverse=True)
        (p1, sub1), (p2, sub2) = ranked[0], ranked[1]
        cat_scores: dict[str, float] = {}
        for p, s in ranked:
            cat_scores[labels.SUBCATEGORIES[s]] = cat_scores.get(labels.SUBCATEGORIES[s], 0.0) + p
        cats = sorted(cat_scores.items(), key=lambda kv: kv[1], reverse=True)
        category = FieldGuess(cats[0][0], round(cats[0][1], 3), [c for c, _ in cats[1:4]])
        subcategory = FieldGuess(sub1, round(p1, 3), [s for _, s in ranked[1:4]])
        return Classification(
            category=category,
            subcategory=subcategory,
            color=base.color,
            pattern=base.pattern,
            model_id=self.model_id,
            model_version=self.model_version,
            duration_ms=int((time.perf_counter() - started) * 1000),
            extra={**base.extra, "category_margin": round(cats[0][1] - (cats[1][1] if len(cats) > 1 else 0), 3),
                   "subcategory_margin": round(p1 - p2, 3), "second": sub2},
        )


_classifier: Classifier | None = None


def get_classifier() -> Classifier:
    """The configured classifier; falls back to the baseline when the model can't load."""
    global _classifier
    if _classifier is None:
        from services.api.app.config import get_settings

        s = get_settings()
        if s.smartmirror_ml_model:
            try:
                import transformers  # noqa: F401

                _classifier = ZeroShotClassifier(s.smartmirror_ml_model, s.smartmirror_ml_device)
            except ImportError:
                log.warning("transformers not installed; using the colour-only baseline (pip install smartmirror[ml])")
                _classifier = BaselineClassifier()
        else:
            _classifier = BaselineClassifier()
    return _classifier


def set_classifier(classifier: Classifier | None) -> None:
    global _classifier
    _classifier = classifier
