"""Background worker: retention sweeps now; try-on and classification jobs as they land.

Run: python -m services.worker.main [--once]
"""
from __future__ import annotations

import argparse
import logging
import time

from services.api.app.database import Base, SessionLocal, engine
from smartmirror.privacy import sweep_expired
from smartmirror.storage import get_store

log = logging.getLogger("smartmirror.worker")
SWEEP_EVERY_S = 15 * 60


def run_once() -> dict[str, int]:
    with SessionLocal() as db:
        return {"expired_assets": sweep_expired(db, get_store())}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="run one sweep and exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    Base.metadata.create_all(bind=engine)
    while True:
        log.info("sweep: %s", run_once())
        if args.once:
            return
        time.sleep(SWEEP_EVERY_S)


if __name__ == "__main__":
    main()
