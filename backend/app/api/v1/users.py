"""Read-only user listing for org admins.

A fuller user-management surface (create, invite, role change, suspend)
will follow once the role/permission story is firmer; this endpoint is
specifically the 'who's in my org?' view.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from app.api.deps import DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.models.user import User
from app.schemas.common import Page
from app.schemas.user_admin import UserAdminRead

router = APIRouter()


@router.get("", response_model=Page[UserAdminRead])
async def list_users(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    role: str | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> Page[UserAdminRead]:
    stmt = select(User).where(User.deleted_at.is_(None))
    if role:
        stmt = stmt.where(User.role == role)
    if status_filter:
        stmt = stmt.where(User.status == status_filter)

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(User.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[UserAdminRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
