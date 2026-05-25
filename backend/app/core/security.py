import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd_context.verify(password, password_hash)


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

    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid token") from exc
