import secrets
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List
from app.core.database import get_db
from app.core.auth import require_admin, require_uploader, get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.event import Event, EventStatus, EventAssignment
from app.models.photo import Photo
from app.schemas import EventCreate, EventUpdate, EventOut

router = APIRouter(prefix="/events", tags=["Events"])

async def _enrich(event: Event, db: AsyncSession) -> EventOut:
    count = await db.execute(select(func.count(Photo.id)).where(Photo.event_id == event.id))
    out = EventOut.model_validate(event)
    out.photo_count = count.scalar() or 0
    return out

# ── Uploader: list events assigned to me ─────────────
@router.get("/my", response_model=List[EventOut])
async def my_events(
    user: User = Depends(require_uploader),
    db: AsyncSession = Depends(get_db)
):
    """Returns all active events where the logged-in user is the assigned uploader."""
    result = await db.execute(
        select(Event)
        .join(EventAssignment, Event.id == EventAssignment.event_id)
        .where(EventAssignment.user_id == user.id)
        .order_by(Event.created_at.desc())
    )
    events = result.scalars().all()
    return [await _enrich(e, db) for e in events]


# ── Admin: create event ──────────────────────────────
@router.post("", response_model=EventOut)
async def create_event(
    body: EventCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    upload_token = secrets.token_urlsafe(32)
    uploader_id = None

    if body.uploader_mobile:
        r = await db.execute(select(User).where(User.mobile == body.uploader_mobile))
        up = r.scalar_one_or_none()
        if not up:
            raise HTTPException(404, "Uploader mobile not registered")
        uploader_id = up.id

    event = Event(
        name=body.name,
        description=body.description,
        admin_id=admin.id,
        uploader_id=uploader_id,
        upload_token=upload_token,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return await _enrich(event, db)

# ── Admin: list all events ───────────────────────────
@router.get("", response_model=List[EventOut])
async def list_events(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Event).where(Event.admin_id == admin.id).order_by(Event.created_at.desc()))
    events = result.scalars().all()
    return [await _enrich(e, db) for e in events]

# ── Admin: get single event ──────────────────────────
@router.get("/{event_id}", response_model=EventOut)
async def get_event(
    event_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Event).where(Event.id == event_id, Event.admin_id == admin.id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(404, "Event not found")
    return await _enrich(event, db)

# ── Admin: update event (status, name, uploader) ─────
@router.patch("/{event_id}", response_model=EventOut)
async def update_event(
    event_id: int,
    body: EventUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Event).where(Event.id == event_id, Event.admin_id == admin.id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(404, "Event not found")

    if body.name is not None:        event.name = body.name
    if body.description is not None: event.description = body.description
    if body.status is not None:      event.status = body.status

    if body.uploader_mobile is not None:
        r = await db.execute(select(User).where(User.mobile == body.uploader_mobile))
        up = r.scalar_one_or_none()
        if not up:
            raise HTTPException(404, "Uploader not found")
        event.uploader_id = up.id

    await db.commit()
    await db.refresh(event)
    return await _enrich(event, db)

# ── Admin: regenerate upload token ───────────────────
@router.post("/{event_id}/regen-upload-token", response_model=EventOut)
async def regen_upload_token(
    event_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Event).where(Event.id == event_id, Event.admin_id == admin.id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(404, "Event not found")
    event.upload_token = secrets.token_urlsafe(32)
    await db.commit()
    await db.refresh(event)
    return await _enrich(event, db)

# ── Uploader: get event by upload token ──────────────
@router.get("/by-token/{token}", response_model=EventOut)
async def get_event_by_upload_token(
    token: str,
    user: User = Depends(require_uploader),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Event).where(
            Event.upload_token == token,
            Event.status == EventStatus.active
        )
    )
    event = result.scalar_one_or_none()

    if not event:
        raise HTTPException(404, "Invalid or inactive event token")

    # ✅ CHECK if assignment already exists
    res = await db.execute(
        select(EventAssignment).where(
            EventAssignment.user_id == user.id,
            EventAssignment.event_id == event.id
        )
    )
    assignment = res.scalar_one_or_none()

    # ✅ CREATE if not exists
    if not assignment:
        db.add(EventAssignment(
            user_id=user.id,
            event_id=event.id
        ))
        await db.commit()

    return await _enrich(event, db)

# ── Uploader: generate a fresh upload token for an event ─
@router.post("/{event_id}/generate-upload-token")
async def generate_upload_token(
    event_id: int,
    user: User = Depends(require_uploader),
    db: AsyncSession = Depends(get_db)
):
    """
    Uploader calls this to get a fresh upload token for an event they're assigned to.
    Returns { token: str } — frontend stores it and uses it for uploads.

    Access allowed if:
    - user is the event's uploader_id
    OR
    - user has an EventAssignment for this event
    """
    # Check if user is assigned via uploader_id
    result = await db.execute(
        select(Event).where(
            Event.id == event_id,
            Event.status == EventStatus.active
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(404, "Event not found or inactive")

    # Check permission: uploader_id OR assignment
    has_assignment = False

    if event.uploader_id == user.id:
        has_assignment = True
    else:
        # Check EventAssignment table
        res = await db.execute(
            select(EventAssignment).where(
                EventAssignment.event_id == event.id,
                EventAssignment.user_id == user.id
            )
        )
        assignment = res.scalar_one_or_none()
        if assignment:
            has_assignment = True

    if not has_assignment:
        raise HTTPException(403, "You are not assigned to this event")

    # Rotate the upload token
    event.upload_token = secrets.token_urlsafe(32)
    await db.commit()
    await db.refresh(event)

    return {"token": event.upload_token}