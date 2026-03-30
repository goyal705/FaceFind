from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum as SAEnum, Text
from sqlalchemy.orm import relationship
from sqlalchemy import UniqueConstraint
from datetime import datetime, timezone
from app.core.database import Base
import enum

class EventStatus(str, enum.Enum):
    active   = "active"
    inactive = "inactive"
    archived = "archived"

class Event(Base):
    __tablename__ = "events"

    id           = Column(Integer, primary_key=True, index=True)
    name         = Column(String(200), nullable=False)
    description  = Column(Text, nullable=True)
    status       = Column(SAEnum(EventStatus), default=EventStatus.active, nullable=False)
    admin_id     = Column(Integer, ForeignKey("users.id"), nullable=False)
    uploader_id  = Column(Integer, ForeignKey("users.id"), nullable=True)  # assigned uploader
    upload_token = Column(String(64), unique=True, nullable=True)  # link for uploader
    created_at   = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at   = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    admin        = relationship("User", back_populates="events", foreign_keys=[admin_id])
    uploader     = relationship("User", foreign_keys=[uploader_id])
    photos       = relationship("Photo", back_populates="event", cascade="all, delete-orphan")
    audience_links = relationship("AudienceLink", back_populates="event", cascade="all, delete-orphan")
    assignments = relationship(
    "EventAssignment",
    back_populates="event",
    cascade="all, delete-orphan"
)

class EventAssignment(Base):
    __tablename__ = "event_assignments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"))

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )

    user = relationship("User", back_populates="event_assignments")
    event = relationship("Event", back_populates="assignments")

    __table_args__ = (
        UniqueConstraint("user_id", "event_id", name="uq_user_event"),
    )