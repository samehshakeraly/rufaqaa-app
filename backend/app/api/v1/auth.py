import hashlib
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.core.exceptions import InvalidCredentials, TokenInvalid
from app.core.security import (
    create_email_verification_token,
    create_password_reset_token,
    create_token,
    decode_email_verification_token,
    decode_password_reset_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.donor import Donor
from app.models.organization import Organization
from app.models.session import UserSession
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    DonorSignupRequest,
    DonorSignupResponse,
    EmailVerifyRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    NotificationPreferences,
    NotificationPreferencesUpdate,
    RefreshRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    TokenPair,
)
from app.schemas.auth import (
    CurrentUser as CurrentUserSchema,
)
from app.scripts.seed import SEED_PLATFORM_ORG_CODE
from app.services.email import send_templated
from app.utils.codes import generate_code

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
async def forgot_password(payload: ForgotPasswordRequest, db: DbSession) -> ForgotPasswordResponse:
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
        reset_url = f"{settings.APP_BASE_URL.rstrip('/')}/reset-password?token={token}"
        send_templated(
            to=user.email,
            template="password_reset",
            locale=settings.DEFAULT_LOCALE,
            reset_url=reset_url,
            expires_minutes=30,
        )
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
    user = await db.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
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
        email_verified_at=user.email_verified_at,
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


# ────────────────────────────────────────────────────────────────────
# Public signup + email verification
# ────────────────────────────────────────────────────────────────────


_EMAIL_VERIFY_TTL_HOURS = 24
_GENERIC_SIGNUP_DETAIL = (
    "If the address is new, a verification email is on its way. "
    "Check your inbox to finish creating your account."
)


def _split_name(full_name: str) -> tuple[str, str]:
    parts = full_name.strip().split(maxsplit=1)
    if len(parts) == 1:
        return parts[0], parts[0]
    return parts[0], parts[1]


async def _send_verification_email(user: User) -> str:
    """Mint a 24h verification token and dispatch the bilingual
    template. Returns the token so callers can echo it back in
    non-production envs."""
    token = create_email_verification_token(user.id, expires_in_hours=_EMAIL_VERIFY_TTL_HOURS)
    base = settings.APP_BASE_URL.rstrip("/")
    verify_url = f"{base}/verify-email/confirm?token={token}"
    locale = "en" if (user.language or "ar").lower().startswith("en") else "ar"
    send_templated(
        to=user.email,
        template="donor_email_verification",
        locale=locale,
        first_name=user.first_name,
        verify_url=verify_url,
        expires_hours=_EMAIL_VERIFY_TTL_HOURS,
    )
    return token


@router.post(
    "/signup",
    response_model=DonorSignupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def donor_signup(payload: DonorSignupRequest, db: DbSession) -> DonorSignupResponse:
    """Public donor signup.

    Anti-enumeration: returns the same 'check your email' shape whether
    the email is brand-new or already registered. New accounts land in
    the PLATFORM org with role='donor' and status='pending_verification'
    until they click the link in the verification email.

    Rate-limited by the global middleware (per-IP). Pending donors can
    browse but cannot sponsor — `require_verified_donor` enforces that.
    """
    existing = await db.scalar(select(User).where(User.email == payload.email))
    if existing is not None:
        # Already on file. Don't create anything, don't leak that the
        # email exists, but if the existing account is itself a
        # not-yet-verified donor, quietly resend the verification.
        if (
            existing.role == "donor"
            and existing.email_verified_at is None
            and existing.deleted_at is None
        ):
            await _send_verification_email(existing)
        return DonorSignupResponse(detail=_GENERIC_SIGNUP_DETAIL)

    platform_org = await db.scalar(
        select(Organization).where(Organization.code == SEED_PLATFORM_ORG_CODE)
    )
    if platform_org is None:
        # Should never happen — seed creates it. Refusing is safer than
        # silently creating a duplicate org row.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Platform organization not provisioned",
        )

    first_name, last_name = _split_name(payload.full_name)
    user = User(
        organization_id=platform_org.id,
        email=payload.email,
        password_hash=hash_password(payload.password),
        first_name=first_name,
        last_name=last_name,
        role="donor",
        status="pending_verification",
        language=payload.preferred_language,
    )
    db.add(user)
    await db.flush()

    donor = Donor(
        organization_id=platform_org.id,
        user_id=user.id,
        code=generate_code("DON"),
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        country_of_residence=payload.country_code,
        preferred_currency=payload.preferred_currency,
        acquisition_channel="website",
    )
    db.add(donor)
    await db.flush()

    token = await _send_verification_email(user)
    # Welcome email (separate so a transient failure on one doesn't
    # block the other; the registry handles both).
    send_templated(
        to=user.email,
        template="donor_welcome",
        locale=payload.preferred_language,
        first_name=first_name,
    )
    await db.commit()

    return DonorSignupResponse(
        detail=_GENERIC_SIGNUP_DETAIL,
        debug_verify_token=(token if settings.ENVIRONMENT != "production" else None),
    )


@router.post("/verify-email", response_model=TokenPair)
async def verify_email(payload: EmailVerifyRequest, db: DbSession, request: Request) -> TokenPair:
    """Consume the email-verification token.

    Marks `email_verified_at`, flips the user from `pending_verification`
    to `active`, and returns a fresh access/refresh pair so the SPA can
    log the donor in immediately."""
    try:
        user_id = decode_email_verification_token(payload.token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token",
        ) from exc
    user = await db.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token",
        )
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now(UTC)
        if user.status == "pending_verification":
            user.status = "active"
        locale = "en" if (user.language or "ar").lower().startswith("en") else "ar"
        send_templated(
            to=user.email,
            template="donor_email_verified",
            locale=locale,
            first_name=user.first_name,
            app_base_url=settings.APP_BASE_URL.rstrip("/"),
        )

    pair = _build_pair(user)
    await _record_session(db, user.id, pair.refresh_token, request)
    await db.commit()
    return pair


@router.post(
    "/resend-verification", response_model=DonorSignupResponse, status_code=status.HTTP_200_OK
)
async def resend_verification(
    payload: ResendVerificationRequest, db: DbSession
) -> DonorSignupResponse:
    """Generic-response resend. Same anti-enumeration posture as signup."""
    user = await db.scalar(select(User).where(User.email == payload.email))
    token: str | None = None
    if (
        user is not None
        and user.email_verified_at is None
        and user.deleted_at is None
        and user.role == "donor"
    ):
        token = await _send_verification_email(user)
        await db.commit()
    return DonorSignupResponse(
        detail="If an unverified account exists for that email, a fresh link has been sent.",
        debug_verify_token=token if settings.ENVIRONMENT != "production" else None,
    )
