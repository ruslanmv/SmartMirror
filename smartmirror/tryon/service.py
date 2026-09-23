from __future__ import annotations

from sqlalchemy.orm import Session

from services.api.app.models import GenerationJob


def create_tryon_job(db: Session, *, profile_id: str, outfit_id: str, body_capture_ref: str, instruction: str) -> GenerationJob:
    job = GenerationJob(
        profile_id=profile_id,
        job_type="tryon",
        status="queued",
        request_json={
            "outfit_id": outfit_id,
            "body_capture_ref": body_capture_ref,
            "instruction": instruction,
        },
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job
