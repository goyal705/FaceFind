from importlib.resources import contents
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import List
from app.core.database import get_db
from app.core.auth import require_uploader
from app.core.config import settings
from app.models.user import User
from app.models.event import Event, EventStatus
from app.models.link import AudienceLink
from app.models.photo import Photo
from app.schemas import LinkOut, FaceSearchResult, AudienceMatchRequest, AudienceMatchResponse
import httpx

router = APIRouter(prefix="/links", tags=["Audience Links"])

def make_audience_url(token: str) -> str:
    return f"{settings.FRONTEND_URL}/audience?token={token}"

# ── Generate new audience link (expires old ones) ─────
@router.post("/generate/{event_id}", response_model=LinkOut)
async def generate_link(
    event_id: int,
    uploader: User = Depends(require_uploader),
    db: AsyncSession = Depends(get_db)
):
    # Validate event
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.status == EventStatus.active)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(404, "Event not found or inactive")

    # Only assigned uploader or admin can generate links
    if uploader.role != "admin" and event.uploader_id != uploader.id:
        raise HTTPException(403, "Not authorized for this event")

    # Expire ALL previous links for this event
    await db.execute(
        update(AudienceLink)
        .where(AudienceLink.event_id == event_id, AudienceLink.is_active == True)
        .values(is_active=False)
    )

    # Create fresh link
    token = secrets.token_urlsafe(24)
    link = AudienceLink(
        event_id=event_id,
        token=token,
        is_active=True,
        created_by=uploader.id,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)

    out = LinkOut.model_validate(link)
    out.audience_url = make_audience_url(token)
    return out

# ── List links for event ──────────────────────────────
@router.get("/event/{event_id}", response_model=List[LinkOut])
async def list_links(
    event_id: int,
    uploader: User = Depends(require_uploader),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(AudienceLink).where(AudienceLink.event_id == event_id).order_by(AudienceLink.created_at.desc())
    )
    links = result.scalars().all()
    out = []
    for l in links:
        o = LinkOut.model_validate(l)
        o.audience_url = make_audience_url(l.token)
        out.append(o)
    return out

# ── PUBLIC: validate audience link + get photos ───────
@router.get("/audience/{token}/photos")
async def audience_photos(token: str, db: AsyncSession = Depends(get_db)):
    """Public endpoint — no auth needed. Returns event photos if link is valid."""
    link_result = await db.execute(
        select(AudienceLink).where(AudienceLink.token == token, AudienceLink.is_active == True)
    )
    link = link_result.scalar_one_or_none()
    if not link:
        raise HTTPException(403, "Link is invalid or has expired")

    # Check expiry
    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        raise HTTPException(403, "Link has expired")

    # Check event active
    event_result = await db.execute(select(Event).where(Event.id == link.event_id))
    event = event_result.scalar_one_or_none()
    if not event or event.status != EventStatus.active:
        raise HTTPException(403, "Event is not active")

    photos_result = await db.execute(
        select(Photo).where(Photo.event_id == link.event_id).order_by(Photo.uploaded_at.asc())
    )
    photos = photos_result.scalars().all()

    return {
        "event_id": event.id,
        "event_name": event.name,
        "photos": [
            {
                "id": p.id,
                "url": p.url,
                "filename": p.filename,
                "face_descriptors": p.face_descriptors,
                "faces_indexed": p.faces_indexed,
            }
            for p in photos
        ]
    }

from math import sqrt
# from .photos import extract_face_descriptors

def normalize(v):
    # flatten if nested
    if isinstance(v[0], list):
        v = v[0]

    norm = sqrt(sum(x * x for x in v))
    if norm == 0:
        return v
    return [x / norm for x in v]


def cosine_distance(a, b):
    return 1 - sum(x * y for x, y in zip(a, b))

import json

@router.post("/audience/{token}/match-photos", response_model=AudienceMatchResponse)
async def audience_match_photos(
    token: str,
    offset: int = Form(...),
    limit: int = Form(...),
    threshold: float = Form(...),
    file: UploadFile = File(...),
    # payload: AudienceMatchRequest,
    db: AsyncSession = Depends(get_db),
):
    link_result = await db.execute(
        select(AudienceLink).where(
            AudienceLink.token == token,
            AudienceLink.is_active == True
        )
    )
    link = link_result.scalar_one_or_none()
    if not link:
        raise HTTPException(403, "Link is invalid or has expired")

    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        raise HTTPException(403, "Link has expired")

    event_result = await db.execute(
        select(Event).where(Event.id == link.event_id)
    )
    event = event_result.scalar_one_or_none()
    if not event or event.status != EventStatus.active:
        raise HTTPException(403, "Event is not active")

    limit = min(max(limit, 1), 50)
    offset = max(offset, 0)

    # 🔥 cosine threshold
    threshold = min(max(threshold, 0.2), 0.6)

    photos_result = await db.execute(
        select(Photo)
        .where(Photo.event_id == link.event_id)
        .order_by(Photo.uploaded_at.asc())
        .offset(offset)
        .limit(limit + 1)
    )

    rows = photos_result.scalars().all()

    has_more = len(rows) > limit
    photos = rows[:limit]

    matches = []

    # 🔥 normalize once
    contents = await file.read()
    async with httpx.AsyncClient(timeout=10.0) as client:
        user_face_result = await client.post(
            "http://192.99.42.157:8000/audience/extract-face",
            files={"file": ("image.jpg", contents, "image/jpeg")}
        )

    user_face = user_face_result.json().get("descriptors", [])
    if isinstance(user_face, str):
        user_face = json.loads(user_face)
    user_descriptor = normalize(user_face)

    for p in photos:
        if not p.face_descriptors:
            continue

        best_dist = float("inf")

        for raw in p.face_descriptors:
            if not raw:
                continue

            dist = cosine_distance(user_descriptor, raw)

            if dist < best_dist:
                best_dist = dist

        if best_dist <= threshold:
            confidence = max(
                0,
                min(100, round((1 - best_dist) * 100))
            )

            matches.append({
                "id": p.id,
                "url": p.url,
                "filename": p.filename,
                "distance": round(best_dist, 6),
                "confidence": confidence,
            })

    matches.sort(key=lambda x: x["distance"])

    return {
        "event_id": event.id,
        "event_name": event.name,
        "offset": offset,
        "limit": limit,
        "processed": len(photos),
        "has_more": has_more,
        "matches": matches,
    }