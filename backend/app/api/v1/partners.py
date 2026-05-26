from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page
from app.schemas.partner import PartnerCreate, PartnerRead, PartnerUpdate
from app.services.audit import record_audit
from app.utils.codes import generate_code


class PartnerStats(BaseModel):
    """Headline metrics for one partner organization."""

    partner_id: UUID
    orphans_total: int
    orphans_sponsored: int
    orphans_available: int
    sponsorships_active: int
    sponsorships_overdue: int
    payments_last_30d_total: Decimal
    payments_last_30d_count: int


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


@router.get("/{partner_id}/stats", response_model=PartnerStats)
async def get_partner_stats(
    partner_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> PartnerStats:
    """Rollup for a single partner: orphan counts, active/overdue
    sponsorships, and 30-day payment totals. All scoped by partner via
    the orphans.partner_organization_id FK."""
    partner = await db.scalar(
        select(PartnerOrganization).where(PartnerOrganization.id == partner_id)
    )
    if partner is None:
        raise NotFound("Partner")

    orphan_ids_subq = (
        select(Orphan.id)
        .where(
            Orphan.partner_organization_id == partner_id,
            Orphan.deleted_at.is_(None),
        )
        .scalar_subquery()
    )

    orphans_total = await db.scalar(
        select(func.count(Orphan.id)).where(
            Orphan.partner_organization_id == partner_id,
            Orphan.deleted_at.is_(None),
        )
    )
    orphans_sponsored = await db.scalar(
        select(func.count(Orphan.id)).where(
            Orphan.partner_organization_id == partner_id,
            Orphan.deleted_at.is_(None),
            Orphan.case_status == "sponsored",
        )
    )
    orphans_available = await db.scalar(
        select(func.count(Orphan.id)).where(
            Orphan.partner_organization_id == partner_id,
            Orphan.deleted_at.is_(None),
            Orphan.case_status == "available",
        )
    )

    sponsorships_active = await db.scalar(
        select(func.count(Sponsorship.id)).where(
            Sponsorship.orphan_id.in_(orphan_ids_subq),
            Sponsorship.status == "active",
        )
    )
    sponsorships_overdue = await db.scalar(
        select(func.count(Sponsorship.id)).where(
            Sponsorship.orphan_id.in_(orphan_ids_subq),
            Sponsorship.status == "overdue",
        )
    )

    thirty_days_ago = datetime.now(UTC) - timedelta(days=30)
    pay_total, pay_count = (
        await db.execute(
            select(
                func.coalesce(func.sum(Payment.amount), 0),
                func.count(Payment.id),
            ).where(
                Payment.orphan_id.in_(orphan_ids_subq),
                Payment.status == "completed",
                Payment.completed_at >= thirty_days_ago,
            )
        )
    ).one()

    return PartnerStats(
        partner_id=partner_id,
        orphans_total=orphans_total or 0,
        orphans_sponsored=orphans_sponsored or 0,
        orphans_available=orphans_available or 0,
        sponsorships_active=sponsorships_active or 0,
        sponsorships_overdue=sponsorships_overdue or 0,
        payments_last_30d_total=Decimal(pay_total or 0),
        payments_last_30d_count=pay_count or 0,
    )
