from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from app.api.deps import DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.models.audit import AuditLogEntry
from app.models.user import User
from app.schemas.audit import AuditLogRead
from app.schemas.common import Page

router = APIRouter()


@router.get("", response_model=Page[AuditLogRead])
async def list_audit(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
    action: str | None = None,
) -> Page[AuditLogRead]:
    # audit_log has no RLS policy in the canonical schema — scope manually.
    stmt = select(AuditLogEntry).where(AuditLogEntry.organization_id == user.organization_id)
    if entity_type:
        stmt = stmt.where(AuditLogEntry.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLogEntry.entity_id == entity_id)
    if action:
        stmt = stmt.where(AuditLogEntry.action == action)

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(AuditLogEntry.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[AuditLogRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
