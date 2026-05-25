from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.partner import PartnerOrganization
from app.models.user import User
from app.schemas.common import Page
from app.schemas.partner import PartnerCreate, PartnerRead, PartnerUpdate
from app.services.audit import record_audit
from app.utils.codes import generate_code

router = APIRouter()


@router.get("", response_model=Page[PartnerRead])
async def list_partners(
    db: DbSession,
    _user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    include_inactive: bool = False,
) -> Page[PartnerRead]:
    stmt = select(PartnerOrganization)
    if not include_inactive:
        stmt = stmt.where(PartnerOrganization.status == "active")
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(
            stmt.order_by(PartnerOrganization.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()
    return Page(
        items=[PartnerRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=PartnerRead, status_code=status.HTTP_201_CREATED)
async def create_partner(
    payload: PartnerCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> PartnerRead:
    partner = PartnerOrganization(
        organization_id=user.organization_id,
        code=generate_code("PTN"),
        name_ar=payload.name_ar,
        name_en=payload.name_en,
        country_code=payload.country_code,
        contact_email=payload.contact_email,
        contact_phone=payload.contact_phone,
        contact_person=payload.contact_person,
        status="active",
    )
    db.add(partner)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="partner.created",
        entity_type="partner_organization",
        entity_id=partner.id,
        new_values={"code": partner.code, "name_ar": partner.name_ar},
    )
    await db.commit()
    await db.refresh(partner)
    return PartnerRead.model_validate(partner)


@router.get("/{partner_id}", response_model=PartnerRead)
async def get_partner(
    partner_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> PartnerRead:
    partner = await db.scalar(
        select(PartnerOrganization).where(PartnerOrganization.id == partner_id)
    )
    if partner is None:
        raise NotFound("Partner")
    return PartnerRead.model_validate(partner)


@router.patch("/{partner_id}", response_model=PartnerRead)
async def update_partner(
    partner_id: UUID,
    payload: PartnerUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> PartnerRead:
    partner = await db.scalar(
        select(PartnerOrganization).where(PartnerOrganization.id == partner_id)
    )
    if partner is None:
        raise NotFound("Partner")
    changes: dict = {}
    for field in ("name_ar", "name_en", "country_code", "status"):
        v = getattr(payload, field)
        if v is not None:
            changes[field] = {"old": getattr(partner, field), "new": v}
            setattr(partner, field, v)
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="partner.updated",
        entity_type="partner_organization",
        entity_id=partner.id,
        old_values={k: v["old"] for k, v in changes.items()},
        new_values={k: v["new"] for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(partner)
    return PartnerRead.model_validate(partner)


@router.delete("/{partner_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_partner(
    partner_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> None:
    """Soft-archive a partner organization."""
    partner = await db.scalar(
        select(PartnerOrganization).where(PartnerOrganization.id == partner_id)
    )
    if partner is None:
        raise NotFound("Partner")
    partner.status = "archived"
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="partner.archived",
        entity_type="partner_organization",
        entity_id=partner.id,
        is_sensitive=True,
    )
    await db.commit()
