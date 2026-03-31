from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from app.models.user import UserRole
from app.models.event import EventStatus

# ── Auth ──────────────────────────────────────────────
class OTPRequest(BaseModel):
    mobile: str = Field(..., pattern=r"^\d{10}$")

class OTPVerify(BaseModel):
    mobile: str = Field(..., pattern=r"^\d{10}$")
    otp: str
    name: Optional[str] = None       # required on first login
    role: Optional[UserRole] = None  # required on first login

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    role: UserRole
    name: str

# ── User ──────────────────────────────────────────────
class UserOut(BaseModel):
    id: int
    mobile: str
    name: str
    role: UserRole
    created_at: datetime
    model_config = {"from_attributes": True}

# ── Event ─────────────────────────────────────────────
class EventCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    description: Optional[str] = None
    uploader_mobile: Optional[str] = None  # assign uploader by mobile

class EventUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[EventStatus] = None
    uploader_mobile: Optional[str] = None

class EventOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    status: EventStatus
    admin_id: int
    uploader_id: Optional[int]
    upload_token: Optional[str]
    photo_count: Optional[int] = 0
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

# ── Photo ─────────────────────────────────────────────
class PhotoOut(BaseModel):
    id: int
    event_id: int
    filename: str
    url: Optional[str]
    faces_indexed: int
    uploaded_at: datetime
    model_config = {"from_attributes": True}

# ── Audience Link ─────────────────────────────────────
class LinkOut(BaseModel):
    id: int
    event_id: int
    token: str
    is_active: bool
    created_at: datetime
    expires_at: Optional[datetime]
    audience_url: Optional[str] = None
    model_config = {"from_attributes": True}

# ── Face Search ───────────────────────────────────────
class FaceSearchResult(BaseModel):
    photo_id: int
    url: str
    filename: str
    confidence: float  # 0-100

class AudienceMatchRequest(BaseModel):
    descriptor: List[float] = Field(..., min_length=128, max_length=128)
    offset: int = 0
    limit: int = 10
    threshold: float = 0.52

class AudienceMatchPhoto(BaseModel):
    id: int
    url: str
    filename: Optional[str] = None
    distance: float
    confidence: int

class AudienceMatchResponse(BaseModel):
    event_id: int
    event_name: str
    offset: int
    limit: int
    processed: int
    has_more: bool
    matches: List[AudienceMatchPhoto]