from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from app.core.database import Base

class Photo(Base):
    __tablename__ = "photos"

    id           = Column(Integer, primary_key=True, index=True)
    event_id     = Column(Integer, ForeignKey("events.id"), nullable=False)
    uploader_id  = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename     = Column(String(255), nullable=False)
    storage_path = Column(String(500), nullable=False)   # local path or S3 key
    url          = Column(String(500), nullable=True)    # public URL
    face_descriptors = Column(JSON, nullable=True)       # list of face embedding arrays
    faces_indexed    = Column(Integer, default=0)        # number of faces found
    uploaded_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    event        = relationship("Event", back_populates="photos")
    uploader     = relationship("User", back_populates="uploads")
