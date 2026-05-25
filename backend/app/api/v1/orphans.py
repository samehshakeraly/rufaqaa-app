from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.orphan import Orphan
from app.models.user import User
from app.schemas.common import Page
from app.schemas.orphan import OrphanCreate, OrphanRead
from app.services.audit import record_audit
from app.utils.codes import generate_code

router = APIRouter()


@router.get("", response_model=Page[OrphanRead])
async def list_orphans(
    db: DbSession,
    _user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    case_status: str | None = None,
) -> Page[OrphanRead]:
    stmt = select(Orphan).where(Orphan.deleted_at.is_(None))
    if case_status:
        stmt = stmt.where(Orphan.case_status == case_status)

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Orphan.created_at.desc()).limit(limit).offset(offset))
    ).all()

    return Page(
        items=[OrphanRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=OrphanRead, status_code=status.HTTP_201_CREATED)
async def create_orphan(
    payload: OrphanCreate,
    db: DbSession,
    user: CurrentUser,
) -> OrphanRead:
    orphan = Orphan(
        organization_id=user.organization_id,
        partner_organization_id=payload.partner_organization_id,
        family_id=payload.family_id,
        code=generate_code("ORF"),
        first_name=payload.first_name,
        middle_name=payload.middle_name,
        family_name=payload.family_name,
        full_name_en=payload.full_name_en,
        date_of_birth=payload.date_of_birth,
        gender=payload.gender,
        nationality=payload.nationality,
        father_name=payload.father_name,
        father_death_date=payload.father_death_date,
        created_by=user.id,
    )
    db.add(orphan)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.created",
        entity_type="orphan",
        entity_id=orphan.id,
        new_values={"code": orphan.code, "case_status": orphan.case_status},
    )
    await db.commit()
    await db.refresh(orphan)
    return OrphanRead.model_validate(orphan)


@router.get("/{orphan_id}", response_model=OrphanRead)
async def get_orphan(
    orphan_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> OrphanRead:
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    return OrphanRead.model_validate(orphan)


@router.delete("/{orphan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_orphan(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> None:
    """Soft-delete an orphan record. Restricted to org admins."""
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    orphan.deleted_at = datetime.now(UTC)
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.deleted",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"code": orphan.code},
        is_sensitive=True,
    )
    await db.commit()
