import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from app.core.database import get_db
from app.core.auth import require_uploader
from app.core.config import settings
from app.models.user import User
from app.models.event import Event, EventStatus
from app.models.photo import Photo
from app.schemas import PhotoOut
from app.services.storage import upload_file, delete_file

router = APIRouter(prefix="/photos", tags=["Photos"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB

# ── Upload photos ─────────────────────────────────────
@router.post("/upload", response_model=List[PhotoOut])
async def upload_photos(
    event_token: str = Form(...),
    files: List[UploadFile] = File(...),
    uploader: User = Depends(require_uploader),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Event).where(Event.upload_token == event_token, Event.status == EventStatus.active)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(403, "Invalid or inactive event token")

    saved = []
    for file in files:
        if file.content_type not in ALLOWED_TYPES:
            continue
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            continue

        stored = await upload_file(content, file.filename, event.id)

        photo = Photo(
            event_id=event.id,
            uploader_id=uploader.id,
            filename=file.filename,
            storage_path=stored["storage_path"],
            url=stored["url"],
            face_descriptors=None,
            faces_indexed=0,
        )
        db.add(photo)
        saved.append(photo)

    await db.commit()
    for photo in saved:
        await db.refresh(photo)
    return [PhotoOut.model_validate(p) for p in saved]


# ── Save face descriptors ─────────────────────────────
@router.post("/{photo_id}/descriptors")
async def save_descriptors(
    photo_id: int,
    payload: dict,
    uploader: User = Depends(require_uploader),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Photo).where(Photo.id == photo_id))
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(404, "Photo not found")
    descriptors = payload.get("descriptors", [])
    photo.face_descriptors = descriptors
    photo.faces_indexed = len(descriptors)
    await db.commit()
    return {"ok": True, "faces_indexed": len(descriptors)}


# ── List photos for an event ──────────────────────────
@router.get("/event/{event_id}", response_model=List[PhotoOut])
async def list_photos(
    event_id: int,
    uploader: User = Depends(require_uploader),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Photo).where(Photo.event_id == event_id).order_by(Photo.uploaded_at.desc())
    )
    return [PhotoOut.model_validate(p) for p in result.scalars().all()]


# ── Delete a photo ────────────────────────────────────
@router.delete("/{photo_id}")
async def delete_photo(
    photo_id: int,
    uploader: User = Depends(require_uploader),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Photo).where(Photo.id == photo_id))
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(404, "Photo not found")
    await delete_file(photo.storage_path)
    await db.delete(photo)
    await db.commit()
    return {"ok": True}


# ── Serve local files (only when STORAGE_TYPE=local) ──
@router.get("/file/{event_id}/{filename}")
async def serve_photo(event_id: int, filename: str):
    if settings.STORAGE_TYPE == "cloudinary":
        raise HTTPException(404, "Use Cloudinary URL directly")
    path = os.path.join(settings.UPLOAD_DIR, str(event_id), filename)
    if not os.path.exists(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path)