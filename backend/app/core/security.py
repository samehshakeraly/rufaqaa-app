import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast
from uuid import UUID

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    return str(_pwd_context.hash(password))


def verify_password(password: str, password_hash: str) -> bool:
    return bool(_pwd_context.verify(password, password_hash))


def create_token(
    subject: UUID | str,
    token_type: TokenType,
    org_id: UUID | None = None,
    role: str | None = None,
    extra: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(UTC)
    if token_type == "access":
        expires = now + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    else:
        expires = now + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)

    payload: dict[str, Any] = {
        "sub": str(subject),
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "type": token_type,
        "jti": secrets.token_urlsafe(16),
    }
    if org_id is not None:
        payload["org"] = str(org_id)
    if role is not None:
        payload["role"] = role
    if extra:
        payload.update(extra)

    return str(jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM))


def decode_token(token: str) -> dict[str, Any]:
    try:
        return cast(
            dict[str, Any],
            jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]),
        )
    except JWTError as exc:
        raise ValueError("Invalid token") from exc


def create_invite_token(user_id: UUID, expires_in_days: int = 7) -> str:
    """One-shot invitation token. Decoded by /users/accept-invite to
    bind a password to a pending account."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=expires_in_days)).timestamp()),
        "type": "invite",
        "jti": secrets.token_urlsafe(16),
    }
    return str(jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM))


def decode_invite_token(token: str) -> UUID:
    payload = decode_token(token)
    if payload.get("type") != "invite":
        raise ValueError("Not an invite token")
    return UUID(payload["sub"])


def create_password_reset_token(user_id: UUID, expires_in_minutes: int = 30) -> str:
    """Short-lived (30 min) token for the forgot-password flow."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expires_in_minutes)).timestamp()),
        "type": "password_reset",
        "jti": secrets.token_urlsafe(16),
    }
    return str(jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM))


def decode_password_reset_token(token: str) -> UUID:
    payload = decode_token(token)
    if payload.get("type") != "password_reset":
        raise ValueError("Not a password-reset token")
    return UUID(payload["sub"])


def create_email_verification_token(user_id: UUID, expires_in_hours: int = 24) -> str:
    """One-shot token used to verify a donor's email post-signup."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=expires_in_hours)).timestamp()),
        "type": "email_verification",
        "jti": secrets.token_urlsafe(16),
    }
    return str(jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM))


def decode_email_verification_token(token: str) -> UUID:
    payload = decode_token(token)
    if payload.get("type") != "email_verification":
        raise ValueError("Not an email-verification token")
    return UUID(payload["sub"])
