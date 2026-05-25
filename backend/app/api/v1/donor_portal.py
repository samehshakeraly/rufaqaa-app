"""Donor-facing read endpoints.

When a user with `role=donor` calls these routes, we look up the donor
row linked via users.id and scope every response to that donor. Other
roles (staff/admin) can pass an explicit donor_id query param so they
can preview a donor's view.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.models.donor import Donor
from app.models.report import OrphanReport
from app.models.sponsorship import Sponsorship
from app.schemas.common import Page
from app.schemas.report import ReportRead
from app.schemas.sponsorship import SponsorshipRead

router = APIRouter()


async def _resolve_donor_id(db, current_user, requested: UUID | None) -> UUID:
    """Determine which donor's data the caller is allowed to see.

    Donors are pinned to their own record; staff may pass donor_id.
    """
    if current_user.role == "donor":
        donor = await db.scalar(select(Donor).where(Donor.user_id == current_user.id))
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


@router.get("/reports", response_model=Page[ReportRead])
async def my_reports(
    db: DbSession,
    user: CurrentUser,
    donor_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ReportRead]:
    """Reports for every orphan this donor sponsors — only the ones that
    have actually been published to donors."""
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
        items=[ReportRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
