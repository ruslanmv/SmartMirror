"""Test isolation: a throwaway SQLite database and media folder per run.

Set before the app is imported, because settings and the engine are created
at import time.
"""
from __future__ import annotations

import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="smartmirror-tests-")
os.environ.setdefault("SMARTMIRROR_DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ.setdefault("SMARTMIRROR_MEDIA_DIR", f"{_tmp}/media")
# Tests pass providers explicitly; never start background try-ons against a real HomePilot.
os.environ.setdefault("SMARTMIRROR_IMAGE_PROVIDER", "none")

from services.api.app import models  # noqa: F401
from services.api.app.database import Base, engine

Base.metadata.create_all(bind=engine)
