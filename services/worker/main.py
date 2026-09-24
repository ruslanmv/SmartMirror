"""Background worker: try-on jobs left queued, and retention sweeps.

Run: python -m services.worker.main [--once]
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import time

from services.api.app.database import Base, SessionLocal, engine
from smartmirror.privacy import sweep_expired
from smartmirror.storage import get_store
from smartmirror.tryon.service import process_queued

log = logging.getLogger("smartmirror.worker")
TICK_S = 3
SWEEP_EVERY_S = 15 * 60


def sweep() -> int:
    with SessionLocal() as db:
        return sweep_expired(db, get_store())


def run_once() -> dict[str, int]:
    return {"tryon_jobs": asyncio.run(process_queued()), "expired_assets": sweep()}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="run one pass and exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    Base.metadata.create_all(bind=engine)
    if args.once:
        log.info("pass: %s", run_once())
        return
    last_sweep = 0.0
    while True:
        ran = asyncio.run(process_queued())
        if ran:
            log.info("try-on jobs run: %d", ran)
        if time.monotonic() - last_sweep > SWEEP_EVERY_S:
            log.info("expired assets removed: %d", sweep())
            last_sweep = time.monotonic()
        time.sleep(TICK_S)


if __name__ == "__main__":
    main()
