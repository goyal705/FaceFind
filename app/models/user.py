from sqlalchemy import Column, Integer, String, DateTime, Enum as SAEnum
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from app.core.database import Base
import enum

class UserRole(str, enum.Enum):
    admin = "admin"
    uploader = "uploader"

class User(Base):
    __tablename__ = "users"

    id         = Column(Integer, primary_key=True, index=True)
    mobile     = Column(String(15), unique=True, nullable=False, index=True)
    name       = Column(String(100), nullable=False)
    role       = Column(SAEnum(UserRole), nullable=False, default=UserRole.uploader)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    events     = relationship("Event", back_populates="admin", foreign_keys="Event.admin_id")
    uploads    = relationship("Photo", back_populates="uploader")
    event_assignments = relationship(
    "EventAssignment",
    back_populates="user",
    cascade="all, delete-orphan"
)