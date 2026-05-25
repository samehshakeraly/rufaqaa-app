from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import make_session
from app.core.exceptions import TokenInvalid
from app.core.security import decode_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")


async def get_db() -> AsyncIterator[AsyncSession]:
    async with make_session() as session:
        yield session


async def get_token_payload(token: Annotated[str, Depends(oauth2_scheme)]) -> dict:
    try:
        payload = decode_token(token)
    except ValueError as exc:
        raise TokenInvalid() from exc
    if payload.get("type") != "access":
        raise TokenInvalid("Wrong token type")
    return payload


async def get_current_user(
    payload: Annotated[dict, Depends(get_token_payload)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    user_id = payload.get("sub")
    org_id = payload.get("org")
    if not user_id or not org_id:
        raise TokenInvalid("Malformed token payload")

    await db.execute(
        text("SELECT set_config('app.current_org_id', :v, true)"),
        {"v": org_id},
    )

    user = await db.scalar(select(User).where(User.id == UUID(user_id)))
    if user is None or user.status != "active":
        raise TokenInvalid("User not found or inactive")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_request_id(
    x_request_id: Annotated[str | None, Header()] = None,
) -> str | None:
    return x_request_id
