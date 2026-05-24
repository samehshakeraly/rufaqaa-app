from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.exceptions import InvalidCredentials, TokenInvalid
from app.core.security import (
    create_token,
    decode_token,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import (
    CurrentUser as CurrentUserSchema,
)
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    TokenPair,
)

router = APIRouter()


@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, db: DbSession) -> TokenPair:
    user = await db.scalar(select(User).where(User.email == payload.email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise InvalidCredentials()
    if user.status != "active":
        raise InvalidCredentials()
    if user.locked_until and user.locked_until > datetime.now(UTC):
        raise InvalidCredentials()

    user.last_login_at = datetime.now(UTC)
    user.failed_login_attempts = 0
    await db.commit()

    return TokenPair(
        access_token=create_token(user.id, "access", user.organization_id, user.role),
        refresh_token=create_token(user.id, "refresh", user.organization_id, user.role),
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest) -> TokenPair:
    try:
        data = decode_token(payload.refresh_token)
    except ValueError as exc:
        raise TokenInvalid() from exc
    if data.get("type") != "refresh":
        raise TokenInvalid("Wrong token type")

    return TokenPair(
        access_token=create_token(data["sub"], "access", data.get("org"), data.get("role")),
        refresh_token=create_token(data["sub"], "refresh", data.get("org"), data.get("role")),
    )


@router.get("/me", response_model=CurrentUserSchema)
async def me(user: CurrentUser) -> CurrentUserSchema:
    return CurrentUserSchema(
        id=user.id,
        email=user.email,
        organization_id=user.organization_id,
        role=user.role,
        first_name=user.first_name,
        last_name=user.last_name,
    )
