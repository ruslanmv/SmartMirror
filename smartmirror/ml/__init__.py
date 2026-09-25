"""Wardrobe intelligence (SM-3): classify a garment photo on the owner's PC.

    get_classifier().classify(image_bytes) -> Classification

The baseline (always available, no downloads) finds the dominant colour and
whether the fabric is solid or patterned. With `pip install smartmirror[ml]`
a zero-shot fashion model (default FashionCLIP, GPU when present) adds the
category and sub-category. Low-confidence fields go to the review queue.
"""
from .classifier import Classification, FieldGuess, get_classifier, needs_review

__all__ = ["Classification", "FieldGuess", "get_classifier", "needs_review"]
