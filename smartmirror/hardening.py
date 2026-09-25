"""Request hardening for tool calls (M5): idempotency, rate limits, trace ids.

Every tool call may carry a reserved ``_meta`` argument::

    {"trace_id": "…", "idempotency_key": "…"}

The web BFF sets both; the argument travels unchanged through OllaBridge Cloud,
OllaBridge Local and HomePilot's ``agentic.invoke``, so one trace id names the
call on every hop. State is per API process, which fits a single home PC.
"""
from __future__ import annotations

import asyncio
import re
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from typing import Any

from services.api.app.config import get_settings

# Tools that create something: a retried call with the same key returns the
# first result instead of creating a duplicate.
IDEMPOTENT_TOOLS = {
    "hp.smartmirror.wardrobe_add",
    "hp.smartmirror.wardrobe_ingest",
    "hp.smartmirror.tryon_create",
    "hp.smartmirror.capture_upload",
    "hp.smartmirror.capture_session_create",
    "hp.smartmirror.set_create",
    "hp.smartmirror.shop_suggest",
}

# Calls per profile per minute. Try-ons and model runs are the expensive ones.
RATE_LIMITS = {
    "hp.smartmirror.tryon_create": 10,
    "hp.smartmirror.wardrobe_ingest": 60,
    "hp.smartmirror.capture_upload": 30,
    "hp.smartmirror.style_suggest": 60,
    "hp.smartmirror.set_create": 20,
    "hp.smartmirror.shop_suggest": 30,
    "hp.smartmirror.profile_delete": 3,
}

_SAFE = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")
IDEMPOTENCY_TTL_S = 15 * 60
MAX_REMEMBERED = 1000


class RateLimited(Exception):
    pass


def split_meta(arguments: dict[str, Any]) -> tuple[dict[str, Any], str | None, str | None]:
    """Remove ``_meta`` from the tool arguments; return (arguments, trace_id, idempotency_key)."""
    args = dict(arguments)
    meta = args.pop("_meta", None)
    if not isinstance(meta, dict):
        return args, None, None
    trace = meta.get("trace_id")
    key = meta.get("idempotency_key")
    return (
        args,
        trace if isinstance(trace, str) and _SAFE.match(trace) else None,
        key if isinstance(key, str) and _SAFE.match(key) else None,
    )


class _Remembered:
    """Results of recent idempotent calls, oldest evicted first."""

    def __init__(self) -> None:
        self.results: OrderedDict[tuple[str, str, str], tuple[float, Any]] = OrderedDict()
        self.locks: dict[tuple[str, str, str], asyncio.Lock] = {}

    def get(self, key: tuple[str, str, str]) -> tuple[bool, Any]:
        hit = self.results.get(key)
        if hit is None or time.monotonic() - hit[0] > IDEMPOTENCY_TTL_S:
            self.results.pop(key, None)
            return False, None
        return True, hit[1]

    def put(self, key: tuple[str, str, str], value: Any) -> None:
        self.results[key] = (time.monotonic(), value)
        self.results.move_to_end(key)
        while len(self.results) > MAX_REMEMBERED:
            self.results.popitem(last=False)


_remembered = _Remembered()
_windows: dict[tuple[str, str], list[float]] = {}


def check_rate(tool: str, profile_id: str) -> None:
    limit = RATE_LIMITS.get(tool)
    if not limit or not get_settings().smartmirror_rate_limits:
        return
    now = time.monotonic()
    window = [t for t in _windows.get((tool, profile_id), []) if now - t < 60]
    if len(window) >= limit:
        _windows[(tool, profile_id)] = window
        raise RateLimited(f"RATE_LIMITED: too many {tool.rsplit('.', 1)[-1].replace('_', ' ')} requests; try again in a minute")
    window.append(now)
    _windows[(tool, profile_id)] = window


async def run(tool: str, profile_id: str, idempotency_key: str | None, call: Callable[[], Awaitable[Any]]) -> Any:
    """Run ``call()`` once per (tool, profile, key); later calls get the first result."""
    if not idempotency_key or tool not in IDEMPOTENT_TOOLS:
        check_rate(tool, profile_id)
        return await call()
    key = (tool, profile_id, idempotency_key)
    lock = _remembered.locks.setdefault(key, asyncio.Lock())
    async with lock:
        seen, value = _remembered.get(key)
        if seen:
            return value
        check_rate(tool, profile_id)
        value = await call()
        _remembered.put(key, value)
    _remembered.locks.pop(key, None)
    return value


def reset() -> None:
    """Forget remembered results and rate windows (tests)."""
    _remembered.results.clear()
    _remembered.locks.clear()
    _windows.clear()
