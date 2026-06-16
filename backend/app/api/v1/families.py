from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.api.deps import DbSession
from app.core.authz import STAFF_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.family import Family, Guardian
from app.models.user import User
from app.schemas.common import Page
from app.schemas.family import (
    FamilyCreate,
    FamilyRead,
    GuardianCreate,
    GuardianRead,
)
from app.services.audit import record_audit
from app.utils.codes import generate_code

router = APIRouter()


@router.get("", response_model=Page[FamilyRead])
async def list_families(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[FamilyRead]:
    # Explicit org scoping, never RLS — the app's superuser connection
    # bypasses RLS, so without this filter families leak across orgs.
    stmt = select(Family).where(Family.organization_id == user.organization_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Family.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[FamilyRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=FamilyRead, status_code=status.HTTP_201_CREATED)
async def create_family(
    payload: FamilyCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> FamilyRead:
    family = Family(
        organization_id=user.organization_id,
        partner_organization_id=payload.partner_organization_id,
        code=generate_code("FAM"),
        family_name=payload.family_name,
        deceased_father_name=payload.deceased_father_name,
        father_death_date=payload.father_death_date,
        father_death_cause=payload.father_death_cause,
        country_code=payload.country_code,
        governorate=payload.governorate,
        city=payload.city,
        district=payload.district,
        address_details=payload.address_details,
        monthly_income=payload.monthly_income,
        income_currency=payload.income_currency,
        housing_status=payload.housing_status,
        notes=payload.notes,
        created_by=user.id,
    )
    db.add(family)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="family.created",
        entity_type="family",
        entity_id=family.id,
        new_values={"code": family.code, "family_name": family.family_name},
    )
    await db.commit()
    await db.refresh(family)
    return FamilyRead.model_validate(family)


@router.get("/{family_id}", response_model=FamilyRead)
async def get_family(
    family_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> FamilyRead:
    # Explicit org scoping, never RLS — the app's superuser connection
    # bypasses RLS. A cross-org id falls through to 404, never revealing it.
    family = await db.scalar(
        select(Family).where(
            Family.id == family_id,
            Family.organization_id == user.organization_id,
        )
    )
    if family is None:
        raise NotFound("Family")
    return FamilyRead.model_validate(family)


# ─── Guardians live under /families because each guardian belongs to a
# family. A separate router would be over-engineering for now.


@router.get("/{family_id}/guardians", response_model=Page[GuardianRead])
async def list_guardians(
    family_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[GuardianRead]:
    # Explicit org scoping, never RLS — the app's superuser connection
    # bypasses RLS. A cross-org family id falls through to 404.
    family = await db.scalar(
        select(Family).where(
            Family.id == family_id,
            Family.organization_id == user.organization_id,
        )
    )
    if family is None:
        raise NotFound("Family")
    stmt = select(Guardian).where(Guardian.family_id == family_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Guardian.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[GuardianRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/{family_id}/guardians",
    response_model=GuardianRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_guardian(
    family_id: UUID,
    payload: GuardianCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> GuardianRead:
    # Explicit org scoping, never RLS — the app's superuser connection
    # bypasses RLS. A cross-org family id falls through to 404.
    family = await db.scalar(
        select(Family).where(
            Family.id == family_id,
            Family.organization_id == user.organization_id,
        )
    )
    if family is None:
        raise NotFound("Family")
    guardian = Guardian(
        organization_id=user.organization_id,
        family_id=family_id,
        full_name=payload.full_name,
        national_id=payload.national_id,
        date_of_birth=payload.date_of_birth,
        gender=payload.gender,
        relation=payload.relation,
        phone=payload.phone,
        whatsapp=payload.whatsapp,
        email=payload.email,
        literacy_level=payload.literacy_level,
        preferred_communication=payload.preferred_communication,
        status="active",
    )
    db.add(guardian)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="guardian.created",
        entity_type="guardian",
        entity_id=guardian.id,
        new_values={"family_id": str(family_id), "relation": guardian.relation},
    )
    await db.commit()
    await db.refresh(guardian)
    return GuardianRead.model_validate(guardian)
