import hashlib
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.core.exceptions import InvalidCredentials, TokenInvalid
from app.core.security import (
    create_password_reset_token,
    create_token,
    decode_password_reset_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.session import UserSession
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    NotificationPreferences,
    NotificationPreferencesUpdate,
    RefreshRequest,
    ResetPasswordRequest,
    TokenPair,
)
from app.schemas.auth import (
    CurrentUser as CurrentUserSchema,
)

router = APIRouter()


def _hash_refresh(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def _record_session(db, user_id, refresh_token: str, request: Request | None) -> None:
    expires = datetime.now(UTC) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    session = UserSession(
        user_id=user_id,
        token_hash=_hash_refresh(refresh_token),
        expires_at=expires,
        ip_address=(request.client.host if request and request.client else None),
    )
    db.add(session)


def _build_pair(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(user.id, "access", user.organization_id, user.role),
        refresh_token=create_token(user.id, "refresh", user.organization_id, user.role),
    )


@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, db: DbSession, request: Request) -> TokenPair:
    user = await db.scalar(select(User).where(User.email == payload.email))
    if user is None:
        raise InvalidCredentials()

    now = datetime.now(UTC)
    if user.locked_until and user.locked_until > now:
        raise InvalidCredentials()

    if not verify_password(payload.password, user.password_hash):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        if user.failed_login_attempts >= settings.LOGIN_MAX_FAILED_ATTEMPTS:
            user.locked_until = now + timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)
            user.failed_login_attempts = 0
        await db.commit()
        raise InvalidCredentials()

    if user.status != "active":
        raise InvalidCredentials()

    user.last_login_at = now
    user.last_login_ip = request.client.host if request.client else None
    user.failed_login_attempts = 0
    user.locked_until = None

    pair = _build_pair(user)
    await _record_session(db, user.id, pair.refresh_token, request)
    await db.commit()
    return pair


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: DbSession, request: Request) -> TokenPair:
    try:
        data = decode_token(payload.refresh_token)
    except ValueError as exc:
        raise TokenInvalid() from exc
    if data.get("type") != "refresh":
        raise TokenInvalid("Wrong token type")
    if not data.get("sub"):
        raise TokenInvalid("Malformed token")

    token_hash = _hash_refresh(payload.refresh_token)
    session = await db.scalar(select(UserSession).where(UserSession.token_hash == token_hash))
    if session is None or session.revoked_at is not None:
        raise TokenInvalid("Refresh token revoked or unknown")
    if session.expires_at < datetime.now(UTC):
        raise TokenInvalid("Refresh token expired")

    user = await db.scalar(select(User).where(User.id == session.user_id))
    if user is None or user.status != "active":
        raise TokenInvalid("User not found or inactive")

    session.revoked_at = datetime.now(UTC)
    pair = _build_pair(user)
    await _record_session(db, user.id, pair.refresh_token, request)
    await db.commit()
    return pair


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, db: DbSession) -> None:
    """Revoke a single refresh token (the device's session)."""
    token_hash = _hash_refresh(payload.refresh_token)
    session = await db.scalar(select(UserSession).where(UserSession.token_hash == token_hash))
    if session is not None and session.revoked_at is None:
        session.revoked_at = datetime.now(UTC)
        await db.commit()


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePasswordRequest,
    db: DbSession,
    user: CurrentUser,
) -> None:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must differ from the current one",
        )

    user.password_hash = hash_password(payload.new_password)
    sessions = (
        await db.scalars(
            select(UserSession).where(
                UserSession.user_id == user.id, UserSession.revoked_at.is_(None)
            )
        )
    ).all()
    now = datetime.now(UTC)
    for s in sessions:
        s.revoked_at = now
    await db.commit()


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(
    payload: ForgotPasswordRequest, db: DbSession
) -> ForgotPasswordResponse:
    """Mint a short-lived password-reset token and (eventually) email it.

    Always returns the same response shape regardless of whether the
    address belongs to a real account, so the endpoint can't be used to
    enumerate users. In non-production environments the freshly minted
    token is included as `debug_token` so the flow is testable without
    an SMTP transport."""
    user = await db.scalar(
        select(User).where(User.email == payload.email, User.deleted_at.is_(None))
    )
    token: str | None = None
    if user is not None and user.status == "active":
        token = create_password_reset_token(user.id)
        # TODO: queue an email — for now the token is only returned in
        # debug mode and the caller copy-pastes the reset link.
    return ForgotPasswordResponse(
        sent=True,
        debug_token=token if settings.ENVIRONMENT != "production" else None,
    )


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(payload: ResetPasswordRequest, db: DbSession) -> None:
    """Consume a reset token, set the new password, and revoke every
    live refresh session so other devices have to sign in again."""
    try:
        user_id = decode_password_reset_token(payload.token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        ) from exc
    user = await db.scalar(
        select(User).where(User.id == user_id, User.deleted_at.is_(None))
    )
    if user is None or user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )
    user.password_hash = hash_password(payload.new_password)
    user.failed_login_attempts = 0
    user.locked_until = None
    sessions = (
        await db.scalars(
            select(UserSession).where(
                UserSession.user_id == user.id, UserSession.revoked_at.is_(None)
            )
        )
    ).all()
    now = datetime.now(UTC)
    for s in sessions:
        s.revoked_at = now
    await db.commit()


def _resolve_notification_prefs(user: User) -> NotificationPreferences:
    """Merge stored JSONB prefs over the schema defaults — keys missing
    from the DB row come from the model's defaults."""
    stored = user.notification_preferences or {}
    return NotificationPreferences(**{**{}, **stored})


@router.get("/me", response_model=CurrentUserSchema)
async def me(user: CurrentUser) -> CurrentUserSchema:
    return CurrentUserSchema(
        id=user.id,
        email=user.email,
        organization_id=user.organization_id,
        role=user.role,
        first_name=user.first_name,
        last_name=user.last_name,
        notification_preferences=_resolve_notification_prefs(user),
    )


@router.patch("/me/notifications", response_model=NotificationPreferences)
async def update_notification_preferences(
    payload: NotificationPreferencesUpdate,
    db: DbSession,
    user: CurrentUser,
) -> NotificationPreferences:
    """Partial update: only the keys you send are touched. Unsent
    channels keep their current value."""
    current = dict(user.notification_preferences or {})
    for field, value in payload.model_dump(exclude_none=True).items():
        current[field] = value
    user.notification_preferences = current
    await db.commit()
    await db.refresh(user)
    return _resolve_notification_prefs(user)
