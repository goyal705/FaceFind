import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
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
from app.schemas import LinkOut, FaceSearchResult

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
