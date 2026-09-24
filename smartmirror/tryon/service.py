"""AI try-on jobs (SM-6).

create_tryon_job() records the request and, in a single-PC setup, runs it
right away in a background thread; the worker picks up anything left queued.
The provider edits the owner's body capture so they wear the outfit's owned
pieces; the result is stored as a preview asset with a TTL and labelled as a
style preview, not a fit guarantee.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from services.api.app.config import get_settings
from services.api.app.models import GenerationJob, Outfit, WardrobeItem
from smartmirror import media
from smartmirror.privacy import record
from smartmirror.providers.vton.base import TryOnRequest, VirtualTryOnProvider
from smartmirror.storage import MediaStore, get_store

log = logging.getLogger("smartmirror.tryon")

DISCLAIMER = "AI style preview — not a fit guarantee"
STALE_AFTER = timedelta(minutes=15)


def item_label(item: WardrobeItem) -> str:
    name = (item.metadata_json or {}).get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    return " ".join(p for p in (item.color, item.material, item.subcategory or item.category) if p)


def build_instruction(items: list[WardrobeItem], extra: str = "") -> str:
    pieces = "; ".join(item_label(i) for i in items) or "the selected outfit"
    text = (
        f"Dress the person in: {pieces}. Keep their face, hair, skin tone, body shape, pose, "
        "camera angle and background exactly the same. Photorealistic, natural fabric and fit."
    )
    if extra.strip():
        text += f" {extra.strip()[:300]}"
    return text


def get_provider() -> VirtualTryOnProvider | None:
    s = get_settings()
    if s.smartmirror_image_provider == "homepilot":
        from smartmirror.providers.vton.homepilot_node import HomePilotNodeEditProvider

        return HomePilotNodeEditProvider(s.homepilot_base_url, s.homepilot_api_key, timeout_s=s.smartmirror_tryon_timeout_s)
    if s.smartmirror_image_provider == "ollabridge-cloud":
        from smartmirror.providers.vton.ollabridge_cloud import OllaBridgeCloudEditProvider

        return OllaBridgeCloudEditProvider(s.ollabridge_base_url, s.ollabridge_token, timeout_s=s.smartmirror_tryon_timeout_s)
    return None


def create_tryon_job(db: Session, *, profile_id: str, outfit_id: str, body_capture_ref: str, instruction: str) -> GenerationJob:
    job = GenerationJob(
        profile_id=profile_id,
        job_type="tryon",
        status="queued",
        request_json={"outfit_id": outfit_id, "body_capture_ref": body_capture_ref, "instruction": instruction},
    )
    db.add(job)
    db.flush()
    record(db, profile_id, "tryon.requested", job.id)
    db.commit()
    db.refresh(job)
    if get_settings().smartmirror_inline_jobs and get_provider() is not None:
        threading.Thread(target=_run_in_thread, args=(job.id,), daemon=True, name=f"tryon-{job.id}").start()
    return job


def _run_in_thread(job_id: str) -> None:
    try:
        asyncio.run(run_tryon_job(job_id))
    except Exception:  # noqa: BLE001 — the job row carries the failure
        log.exception("try-on job %s crashed", job_id)


def _fail(db: Session, job: GenerationJob, error: str) -> None:
    job.status = "failed"
    job.error_code = error[:128]
    record(db, job.profile_id, "tryon.failed", job.id)
    db.commit()


async def run_tryon_job(
    job_id: str,
    *,
    provider: VirtualTryOnProvider | None = None,
    store: MediaStore | None = None,
) -> str:
    """Run one queued try-on job to completion. Returns the final status."""
    from services.api.app.database import SessionLocal

    provider = provider or get_provider()
    store = store or get_store()
    with SessionLocal() as db:
        job = db.get(GenerationJob, job_id)
        if job is None or job.status not in ("queued",):
            return job.status if job else "missing"
        if provider is None:
            _fail(db, job, "CAPABILITY_UNAVAILABLE: no try-on provider configured")
            return job.status
        job.status, job.progress, job.provider = "running", 0.1, provider.name
        db.commit()

        req = job.request_json or {}
        try:
            outfit = db.get(Outfit, str(req.get("outfit_id")))
            if outfit is None:
                raise media.MediaRejected("RESOURCE_REJECTED: outfit not found")
            items = list(db.scalars(select(WardrobeItem).where(WardrobeItem.id.in_(outfit.item_ids))))
            items.sort(key=lambda i: outfit.item_ids.index(i.id))
            photo, asset = media.load(db, store, str(req.get("body_capture_ref")), job.profile_id)
            request = TryOnRequest(
                person_image=photo,
                person_content_type=asset.content_type,
                garment_refs=[i.id for i in items],
                instruction=build_instruction(items, str(req.get("instruction") or "")),
            )
        except media.MediaRejected as exc:
            _fail(db, job, str(exc))
            return job.status

        try:
            result = await provider.generate(request)
            if not result.images:
                raise RuntimeError("IMAGE_EDIT_FAILED: no image produced")
            preview = media.ingest(
                db, store,
                profile_id=job.profile_id,
                kind="preview",
                data=result.images[0],
                ttl_hours=get_settings().smartmirror_preview_ttl_hours,
                max_edge=2048,
            )
        except Exception as exc:  # noqa: BLE001 — provider errors carry a code prefix
            text = str(exc) or type(exc).__name__
            _fail(db, job, text if ":" in text[:32] else f"IMAGE_EDIT_FAILED: {text}")
            return job.status

        job.status, job.progress = "succeeded", 1.0
        job.result_json = {"preview_asset_id": preview.id, "provider": result.provider, "disclaimer": DISCLAIMER}
        record(db, job.profile_id, "tryon.succeeded", job.id)
        db.commit()
        return job.status


async def process_queued(limit: int = 3) -> int:
    """Worker: run queued try-on jobs (e.g. after an API restart). Returns how many ran."""
    from services.api.app.database import SessionLocal

    now = datetime.now(UTC)
    with SessionLocal() as db:
        jobs = list(db.scalars(select(GenerationJob).where(GenerationJob.job_type == "tryon", GenerationJob.status.in_(("queued", "running")))))
        ids = []
        for job in jobs:
            created = job.created_at if job.created_at.tzinfo else job.created_at.replace(tzinfo=UTC)
            if job.status == "running" and now - created > STALE_AFTER:
                _fail(db, job, "NODE_RESTARTED: the try-on was interrupted")
            elif job.status == "queued":
                ids.append(job.id)
    for job_id in ids[:limit]:
        await run_tryon_job(job_id)
    return min(len(ids), limit)
