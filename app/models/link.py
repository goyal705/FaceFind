from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from app.core.database import Base

class AudienceLink(Base):
    __tablename__ = "audience_links"

    id         = Column(Integer, primary_key=True, index=True)
    event_id   = Column(Integer, ForeignKey("events.id"), nullable=False)
    token      = Column(String(64), unique=True, nullable=False, index=True)
    is_active  = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=True)

    event      = relationship("Event", back_populates="audience_links")
    creator    = relationship("User", foreign_keys=[created_by])
