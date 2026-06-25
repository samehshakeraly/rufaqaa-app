"""Donor-facing read endpoints.

When a user with `role=donor` calls these routes, we look up the donor
row linked via users.id and scope every response to that donor. Other
roles (staff/admin) can pass an explicit donor_id query param so they
can preview a donor's view.
"""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.api.v1.public import PublicOrphanDetail, to_public_detail
from app.core.exceptions import NotFound
from app.models.donor import Donor
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.payment import Payment
from app.models.report import OrphanReport
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page
from app.schemas.payment import PaymentDonorRead
from app.schemas.report import (
    ActivitiesSection,
    EducationProgress,
    HealthStatus,
    PsychologicalStatus,
    QuranProgress,
    ReportDonorRead,
)
from app.schemas.sponsorship import SponsorshipRead

router = APIRouter()


def _visible_section[SectionT: BaseModel](
    raw: dict[str, Any] | None,
    key: str,
    visibility: dict[str, bool],
    model: type[SectionT],
) -> SectionT | None:
    """Parse a stored JSONB section into its typed model, but only when the
    supervisor left it visible. A section is shown UNLESS its key is explicitly
    ``False`` in ``section_visibility`` — so an empty map ⇒ everything visible.
    Hidden (or absent) sections collapse to ``None``.
    """
    if raw is None or visibility.get(key) is False:
        return None
    return model.model_validate(raw)


def _donor_report_view(report: OrphanReport) -> ReportDonorRead:
    """Project one report row into the donor-safe schema, dropping every section
    the supervisor hid. ``section_visibility`` is consumed here and never leaves
    the server.
    """
    vis = report.section_visibility or {}
    return ReportDonorRead.model_validate(
        {
            "id": report.id,
            "orphan_id": report.orphan_id,
            "report_type": report.report_type,
            "period_start": report.period_start,
            "period_end": report.period_end,
            "summary": report.summary,
            "donor_message": report.donor_message,
            "is_milestone": report.is_milestone,
            "milestone_label": report.milestone_label,
            "status": report.status,
            "submitted_at": report.submitted_at,
            "partner_approved_at": report.partner_approved_at,
            "org_approved_at": report.org_approved_at,
            "published_at": report.published_at,
            "photos_count": report.photos_count,
            "videos_count": report.videos_count,
            "documents_count": report.documents_count,
            "created_at": report.created_at,
            "updated_at": report.updated_at,
            "educational_progress": _visible_section(
                report.educational_progress, "education", vis, EducationProgress
            ),
            "quran_progress": _visible_section(report.quran_progress, "quran", vis, QuranProgress),
            "activities": _visible_section(report.activities, "activities", vis, ActivitiesSection),
            "health_status": _visible_section(report.health_status, "health", vis, HealthStatus),
            "psychological_status": _visible_section(
                report.psychological_status, "psychological", vis, PsychologicalStatus
            ),
        }
    )


async def _resolve_donor_id(db: AsyncSession, current_user: User, requested: UUID | None) -> UUID:
    """Determine which donor's data the caller is allowed to see.

    Donors are pinned to their own record; staff may pass donor_id.
    """
    if current_user.role == "donor":
        donor: Donor | None = await db.scalar(select(Donor).where(Donor.user_id == current_user.id))
        if donor is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Your account is not linked to a donor record",
            )
        if requested is not None and requested != donor.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Donors can only view their own data",
            )
        return donor.id

    if requested is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Non-donor callers must supply donor_id",
        )
    donor = await db.scalar(select(Donor).where(Donor.id == requested))
    if donor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Donor not found")
    return donor.id


@router.get("/sponsorships", response_model=Page[SponsorshipRead])
async def my_sponsorships(
    db: DbSession,
    user: CurrentUser,
    donor_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[SponsorshipRead]:
    did = await _resolve_donor_id(db, user, donor_id)
    stmt = select(Sponsorship).where(Sponsorship.donor_id == did)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Sponsorship.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[SponsorshipRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/sponsorships/{orphan_id}/profile", response_model=PublicOrphanDetail)
async def my_sponsored_orphan_profile(
    db: DbSession,
    user: CurrentUser,
    orphan_id: UUID,
    donor_id: Annotated[UUID | None, Query()] = None,
) -> PublicOrphanDetail:
    """The donor-safe humanizing profile of a child this donor sponsors.

    Unlike the public browse endpoint, scoping here is by an actual
    Sponsorship row (this donor → this orphan), NOT by ``case_status`` —
    so a sponsored child (case_status='sponsored', no longer browseable)
    still resolves. A child the donor does not sponsor 404s exactly like
    an unknown id, so existence never leaks.

    The exposed field set is exactly ``PublicOrphanDetail`` — the canonical
    donor-safe contract defined in app.api.v1.public — reused verbatim via
    ``to_public_detail``; nothing beyond it is serialised.
    """
    did = await _resolve_donor_id(db, user, donor_id)
    row = (
        await db.execute(
            select(Orphan, PartnerOrganization.name_ar)
            .join(Sponsorship, Sponsorship.orphan_id == Orphan.id)
            .outerjoin(
                PartnerOrganization,
                PartnerOrganization.id == Orphan.partner_organization_id,
            )
            .where(
                Orphan.id == orphan_id,
                Orphan.deleted_at.is_(None),
                Sponsorship.donor_id == did,
            )
        )
    ).first()
    if row is None:
        raise NotFound("Orphan")
    orphan, partner_name = row
    return to_public_detail(orphan, partner_name)


@router.get("/reports", response_model=Page[ReportDonorRead])
async def my_reports(
    db: DbSession,
    user: CurrentUser,
    donor_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ReportDonorRead]:
    """Reports for every orphan this donor sponsors — only the ones that
    have actually been published to donors. Each report is projected through
    its ``section_visibility`` so hidden sections never reach the donor."""
    did = await _resolve_donor_id(db, user, donor_id)
    sub = select(Sponsorship.orphan_id).where(Sponsorship.donor_id == did)
    stmt = select(OrphanReport).where(
        OrphanReport.orphan_id.in_(sub),
        OrphanReport.status == "published_to_donor",
    )
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(
            stmt.order_by(OrphanReport.published_at.desc()).limit(limit).offset(offset)
        )
    ).all()
    return Page(
        items=[_donor_report_view(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def _donor_payment_view(p: Payment) -> PaymentDonorRead:
    # from_attributes reads only the declared donor-safe fields; nothing else leaves the server
    return PaymentDonorRead.model_validate(p)


@router.get("/payments", response_model=Page[PaymentDonorRead])
async def my_payments(
    db: DbSession,
    user: CurrentUser,
    orphan_id: Annotated[UUID | None, Query()] = None,
    donor_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[PaymentDonorRead]:
    """Every payment the calling donor made — optionally narrowed to one
    sponsored child. Hard-scoped to the donor's own payments."""
    did = await _resolve_donor_id(db, user, donor_id)
    stmt = select(Payment).where(Payment.donor_id == did)
    if orphan_id is not None:
        # defense in depth: only orphans this donor actually sponsors
        sponsored = select(Sponsorship.orphan_id).where(Sponsorship.donor_id == did)
        stmt = stmt.where(Payment.orphan_id == orphan_id, Payment.orphan_id.in_(sponsored))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = func.coalesce(Payment.completed_at, Payment.failed_at, Payment.initiated_at).desc()
    rows = (await db.scalars(stmt.order_by(order).limit(limit).offset(offset))).all()
    return Page(
        items=[_donor_payment_view(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
