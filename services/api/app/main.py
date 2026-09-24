from __future__ import annotations

from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from integrations.homepilot.mcp_server.router import router as mcp_router
from smartmirror.privacy import delete_profile_data, sweep_expired
from smartmirror.storage import get_store
from smartmirror.stylist.service import suggest
from smartmirror.tryon.service import create_tryon_job

from .database import Base, engine, get_db
from .models import GenerationJob, WardrobeItem
from .schemas import (
    JobOut,
    OutfitCandidate,
    StyleSuggestIn,
    StyleSuggestOut,
    TryOnCreateIn,
    WardrobeItemCreate,
    WardrobeItemOut,
)

app = FastAPI(
    title="SmartMirror API",
    version="0.1.0",
    description="Independent wardrobe/styling service integrated with HomePilot and OllaBridge.",
)
app.include_router(mcp_router)


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "smartmirror", "version": "0.1.0"}


@app.get("/v1/capabilities")
def capabilities() -> dict:
    return {
        "wardrobe": True,
        "style_suggest": True,
        "tryon_jobs": True,
        "homepilot_mcp": True,
        "echo_camera_required": False,
    }


@app.post("/v1/wardrobe/items", response_model=WardrobeItemOut, status_code=201)
def create_wardrobe_item(body: WardrobeItemCreate, db: Session = Depends(get_db)) -> WardrobeItemOut:
    item = WardrobeItem(
        profile_id=body.profile_id,
        category=body.category,
        subcategory=body.subcategory,
        color=body.color,
        material=body.material,
        fit=body.fit,
        length=body.length,
        metadata_json=body.metadata,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return WardrobeItemOut(id=item.id, **body.model_dump())


@app.get("/v1/wardrobe/items", response_model=list[WardrobeItemOut])
def list_wardrobe_items(profile_id: str = "local-user", db: Session = Depends(get_db)) -> list[WardrobeItemOut]:
    rows = list(db.scalars(select(WardrobeItem).where(WardrobeItem.profile_id == profile_id)))
    return [
        WardrobeItemOut(
            id=x.id,
            profile_id=x.profile_id,
            category=x.category,
            subcategory=x.subcategory,
            color=x.color,
            material=x.material,
            fit=x.fit,
            length=x.length,
            metadata=x.metadata_json,
        )
        for x in rows
    ]


@app.post("/v1/style/requests", response_model=StyleSuggestOut)
def style_request(body: StyleSuggestIn, db: Session = Depends(get_db)) -> StyleSuggestOut:
    req, outfits = suggest(db, body.profile_id, body.prompt, body.limit)
    return StyleSuggestOut(
        request_id=req.id,
        normalized_intent=req.normalized_intent,
        outfits=[
            OutfitCandidate(id=o.id, item_ids=o.item_ids, score=o.score, explanation=o.explanation)
            for o in outfits
        ],
    )


@app.post("/v1/tryon/jobs", response_model=JobOut, status_code=202)
def create_tryon(body: TryOnCreateIn, db: Session = Depends(get_db)) -> JobOut:
    job = create_tryon_job(
        db,
        profile_id=body.profile_id,
        outfit_id=body.outfit_id,
        body_capture_ref=body.body_capture_ref,
        instruction=body.instruction,
    )
    return JobOut(id=job.id, status=job.status, progress=job.progress, result=job.result_json)


@app.get("/v1/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, db: Session = Depends(get_db)) -> JobOut:
    job = db.get(GenerationJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobOut(
        id=job.id,
        status=job.status,
        progress=job.progress,
        result=job.result_json,
        error_code=job.error_code,
    )


DbSession = Annotated[Session, Depends(get_db)]


@app.delete("/v1/profile/data")
def delete_profile(db: DbSession, profile_id: str = "local-user", confirm: str = "") -> dict:
    """Delete everything SmartMirror stores for a profile. Requires confirm=DELETE."""
    if confirm != "DELETE":
        raise HTTPException(status_code=400, detail='Add ?confirm=DELETE to delete everything')
    return {"deleted": delete_profile_data(db, get_store(), profile_id)}


@app.post("/v1/maintenance/sweep")
def sweep(db: DbSession) -> dict:
    """Apply retention: expired body captures and previews are removed."""
    return {"expired_assets": sweep_expired(db, get_store())}
