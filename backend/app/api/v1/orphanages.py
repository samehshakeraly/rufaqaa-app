from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.core.exceptions import NotFound
from app.models.orphanage import Orphanage
from app.models.user import User
from app.schemas.common import Page
from app.schemas.orphanage import (
    OrphanageCreate,
    OrphanageRead,
    OrphanageUpdate,
)
from app.services.audit import record_audit
from app.utils.codes import generate_code

router = APIRouter()


async def _assert_user_can_manage(
    db: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    *,
    exclude_orphanage_id: UUID | None = None,
) -> None:
    """Validate that ``user_id`` may be assigned as a dar's manager.

    Mirrors the org-scoped validation in ``services/orphans._assert_orphanage_in_org``:
    we check explicitly (400) rather than trusting RLS — a Postgres superuser
    connection bypasses it. Two rules:

    * the user must exist, belong to ``organization_id`` and be an
      ``orphanage_manager`` (the role 0011 introduced);
    * the user must not already manage a *different* dar. The DB enforces this
      with a UNIQUE constraint on ``manager_user_id``; pre-checking here turns
      its raw 409 unique-violation into a clean 400. ``exclude_orphanage_id``
      lets an update re-assert the dar's own current manager without tripping.
    """
    manager = await db.scalar(
        select(User).where(
            User.id == user_id,
            User.organization_id == organization_id,
        )
    )
    if manager is None or manager.role != "orphanage_manager":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="manager_user_id must reference an orphanage_manager in this organization",
        )

    stmt = select(Orphanage.id).where(Orphanage.manager_user_id == user_id)
    if exclude_orphanage_id is not None:
        stmt = stmt.where(Orphanage.id != exclude_orphanage_id)
    if (await db.scalar(stmt)) is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="user already manages another orphanage",
        )


# NOTE: every query below scopes to user.organization_id EXPLICITLY rather
# than leaning on the orphanages_org_isolation RLS policy alone. This is a
# deliberate departure from the families template: a Postgres superuser
# connection bypasses RLS unconditionally (the posture of the CI / test DB),
# so RLS-only endpoints leak across orgs in that environment. The explicit
# filter is defense-in-depth — redundant-but-harmless when RLS is in force,
# the real guard when it is bypassed.


@router.get("", response_model=Page[OrphanageRead])
async def list_orphanages(
    db: DbSession,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[OrphanageRead]:
    stmt = select(Orphanage).where(Orphanage.organization_id == user.organization_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Orphanage.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[OrphanageRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=OrphanageRead, status_code=status.HTTP_201_CREATED)
async def create_orphanage(
    payload: OrphanageCreate,
    db: DbSession,
    user: CurrentUser,
) -> OrphanageRead:
    if payload.manager_user_id is not None:
        await _assert_user_can_manage(db, payload.manager_user_id, user.organization_id)
    orphanage = Orphanage(
        organization_id=user.organization_id,
        partner_organization_id=payload.partner_organization_id,
        code=generate_code("DAR"),
        name_ar=payload.name_ar,
        name_en=payload.name_en,
        country_code=payload.country_code,
        governorate=payload.governorate,
        city=payload.city,
        district=payload.district,
        address_details=payload.address_details,
        status=payload.status,
        notes=payload.notes,
        manager_user_id=payload.manager_user_id,
        created_by=user.id,
    )
    db.add(orphanage)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphanage.created",
        entity_type="orphanage",
        entity_id=orphanage.id,
        new_values={"code": orphanage.code, "name_ar": orphanage.name_ar},
    )
    await db.commit()
    await db.refresh(orphanage)
    return OrphanageRead.model_validate(orphanage)


@router.get("/{orphanage_id}", response_model=OrphanageRead)
async def get_orphanage(
    orphanage_id: UUID,
    db: DbSession,
    user: CurrentUser,
) -> OrphanageRead:
    orphanage = await db.scalar(
        select(Orphanage).where(
            Orphanage.id == orphanage_id,
            Orphanage.organization_id == user.organization_id,
        )
    )
    if orphanage is None:
        raise NotFound("Orphanage")
    return OrphanageRead.model_validate(orphanage)


@router.patch("/{orphanage_id}", response_model=OrphanageRead)
async def update_orphanage(
    orphanage_id: UUID,
    payload: OrphanageUpdate,
    db: DbSession,
    user: CurrentUser,
) -> OrphanageRead:
    orphanage = await db.scalar(
        select(Orphanage).where(
            Orphanage.id == orphanage_id,
            Orphanage.organization_id == user.organization_id,
        )
    )
    if orphanage is None:
        raise NotFound("Orphanage")
    updates = payload.model_dump(exclude_unset=True)
    # A present, non-null manager is validated before assignment; a present
    # null clears it (no check needed); an absent key leaves it untouched.
    if updates.get("manager_user_id") is not None:
        await _assert_user_can_manage(
            db,
            updates["manager_user_id"],
            user.organization_id,
            exclude_orphanage_id=orphanage.id,
        )
    for field, value in updates.items():
        setattr(orphanage, field, value)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphanage.updated",
        entity_type="orphanage",
        entity_id=orphanage.id,
        # mode="json" keeps the audit JSONB-safe now that an updatable field
        # (manager_user_id) is a UUID rather than a plain string.
        new_values=payload.model_dump(exclude_unset=True, mode="json"),
    )
    await db.commit()
    await db.refresh(orphanage)
    return OrphanageRead.model_validate(orphanage)
