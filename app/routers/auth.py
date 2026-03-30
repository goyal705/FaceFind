from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.config import settings
from app.core.auth import create_access_token
from app.models.user import User, UserRole
from app.schemas import OTPRequest, OTPVerify, TokenOut

router = APIRouter(prefix="/auth", tags=["Auth"])

# In production: store OTP in Redis with TTL, send via SMS
# For now: static OTP + in-memory store
_otp_store: dict[str, str] = {}

@router.post("/send-otp")
async def send_otp(body: OTPRequest):
    """Send OTP to mobile (static 123456 for now)."""
    _otp_store[body.mobile] = settings.STATIC_OTP
    # TODO: integrate SMS gateway here
    return {"message": f"OTP sent to {body.mobile}", "dev_otp": settings.STATIC_OTP}

@router.post("/verify-otp", response_model=TokenOut)
async def verify_otp(body: OTPVerify, db: AsyncSession = Depends(get_db)):
    """Verify OTP and return JWT. Creates user on first login."""
    stored = _otp_store.get(body.mobile)
    if not stored or stored != body.otp:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    del _otp_store[body.mobile]

    # Find or create user
    result = await db.execute(select(User).where(User.mobile == body.mobile))
    user = result.scalar_one_or_none()

    if not user:
        if not body.name:
            raise HTTPException(status_code=400, detail="Name required for first login")
        role = body.role or UserRole.uploader
        user = User(mobile=body.mobile, name=body.name, role=role)
        db.add(user)
        await db.commit()
        await db.refresh(user)

    token = create_access_token({"sub": str(user.id), "role": user.role})
    return TokenOut(access_token=token, user_id=user.id, role=user.role, name=user.name)
