"""Build HomePilot persona packages (.hpersona) from the source folders here.

Each sub-folder with a ``manifest.json`` is zipped into ``<name>.hpersona``
next to it. The build is deterministic (sorted entries, fixed timestamps,
normalised JSON), so the committed package can be checked against its source.

Usage:
    python integrations/homepilot/personas/build.py          # build all
    python integrations/homepilot/personas/build.py --check  # fail if stale
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import zipfile
from pathlib import Path

PERSONAS_DIR = Path(__file__).resolve().parent
_FIXED_DATE = (2026, 1, 1, 0, 0, 0)
# HomePilot's importer requires these; everything else is optional.
REQUIRED_FILES = (
    "manifest.json",
    "blueprint/persona_agent.json",
    "blueprint/persona_appearance.json",
)


def persona_sources() -> list[Path]:
    return sorted(p.parent for p in PERSONAS_DIR.glob("*/manifest.json"))


def build_package(source: Path) -> bytes:
    """Return the .hpersona bytes for one persona source folder."""
    missing = [name for name in REQUIRED_FILES if not (source / name).is_file()]
    if missing:
        raise FileNotFoundError(f"{source.name}: missing {', '.join(missing)}")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(p for p in source.rglob("*") if p.is_file()):
            arcname = path.relative_to(source).as_posix()
            data = path.read_bytes()
            if path.suffix == ".json":
                # Normalise so formatting-only edits do not change the package.
                data = (json.dumps(json.loads(data), indent=2, ensure_ascii=False) + "\n").encode()
            info = zipfile.ZipInfo(arcname, date_time=_FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, data)
    return buf.getvalue()


def package_path(source: Path) -> Path:
    return source.parent / f"{source.name}.hpersona"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if a committed package is stale")
    args = parser.parse_args(argv)

    stale = []
    for source in persona_sources():
        data = build_package(source)
        target = package_path(source)
        if args.check:
            if not target.is_file() or target.read_bytes() != data:
                stale.append(target.name)
            continue
        target.write_bytes(data)
        print(f"built {target.relative_to(PERSONAS_DIR.parents[2])} ({len(data)} bytes)")

    if stale:
        print(f"stale persona packages: {', '.join(stale)}; run build.py", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
