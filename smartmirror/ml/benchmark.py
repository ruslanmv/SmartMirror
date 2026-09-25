"""Measure the classifier on this PC: python -m smartmirror.ml.benchmark <photos-dir> [--model ID]

Prints per-image time and, when files are named "<category>__anything.jpg",
top-1 category accuracy — the M3 target is >= 85 % on a household set.
"""
from __future__ import annotations

import argparse
import statistics
import time
from pathlib import Path

from .classifier import BaselineClassifier, ZeroShotClassifier


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("folder", type=Path)
    parser.add_argument("--model", default="", help="transformers model id; empty = colour-only baseline")
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()

    clf = ZeroShotClassifier(args.model, args.device) if args.model else BaselineClassifier()
    files = sorted(p for p in args.folder.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    times, hits, labelled = [], 0, 0
    for path in files:
        started = time.perf_counter()
        result = clf.classify(path.read_bytes())
        times.append((time.perf_counter() - started) * 1000)
        expected = path.stem.split("__", 1)[0] if "__" in path.stem else None
        if expected:
            labelled += 1
            hits += int(result.category.value == expected)
        print(f"{path.name}: {result.category.value or '?'} / {result.subcategory.value or '?'} / {result.color.value} "
              f"({times[-1]:.0f} ms)")
    if times:
        print(f"\n{len(times)} images · median {statistics.median(times):.0f} ms · model {clf.model_id}")
    if labelled:
        print(f"category top-1: {hits}/{labelled} = {100 * hits / labelled:.1f} %")


if __name__ == "__main__":
    main()
