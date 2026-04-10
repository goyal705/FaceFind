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
import numpy as np
import cv2
# from insightface.app import FaceAnalysis
import httpx

# face_app = FaceAnalysis(name="buffalo_s")  # best model
# face_app.prepare(ctx_id=-1)  # use -1 for CPU

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
        
        try:
            # descriptors = extract_face_descriptors(content)
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(f"{settings.MODEL_URL}/index-photo/{photo.id}")
        except Exception as e:
            print("Face extraction failed:", e)

        descriptors = []
        stored = await upload_file(content, file.filename, event.id)

        photo = Photo(
            event_id=event.id,
            uploader_id=uploader.id,
            filename=file.filename,
            storage_path=stored["storage_path"],
            url=stored["url"],
            face_descriptors=descriptors,
            faces_indexed=len(descriptors),
            indexing_status="pending"
        )
        db.add(photo)
        saved.append(photo)

    await db.commit()
    for photo in saved:
        await db.refresh(photo)
    return [PhotoOut.model_validate(p) for p in saved]

# def extract_face_descriptors(image_bytes: bytes):
#     np_arr = np.frombuffer(image_bytes, np.uint8)
#     img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

#     if img is None:
#         return []

#     # ✅ resize (huge speed boost)
#     h, w = img.shape[:2]
#     if w > 640:
#         scale = 640 / w
#         img = cv2.resize(img, (int(w * scale), int(h * scale)))

#     faces = face_app.get(img)

#     if not faces:
#         return []

#     # ✅ sort by face size (largest first)
#     faces = sorted(
#         faces,
#         key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
#         reverse=True
#     )

#     # ✅ keep only top 2–3 faces
#     faces = faces[:3]

#     descriptors = []
#     for face in faces:
#         # ✅ confidence filter
#         if face.det_score < 0.7:
#             continue

#         emb = face.embedding

#         # ✅ normalize
#         norm = np.linalg.norm(emb)
#         if norm != 0:
#             emb = emb / norm

#         descriptors.append(emb.tolist())

#     return descriptors

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