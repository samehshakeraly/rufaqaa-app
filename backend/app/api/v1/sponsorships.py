import csv
import io
from collections.abc import Sequence
from datetime import UTC, date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.authz import FINANCE_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.donor import Donor
from app.models.orphan import Orphan
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page
from app.schemas.sponsorship import (
    SponsorshipCancel,
    SponsorshipCreate,
    SponsorshipRead,
    SponsorshipUpdate,
)
from app.utils.codes import generate_code

router = APIRouter()

ACTIVE_LIKE = ("active", "paused", "overdue")


def _next_monthly(start: date) -> date:
    year, month = start.year, start.month + 1
    if month > 12:
        month, year = 1, year + 1
    day = min(start.day, 28)
    return date(year, month, day)


def _enrich(sp: Sponsorship, donor: Donor | None, orphan: Orphan | None) -> SponsorshipRead:
    out = SponsorshipRead.model_validate(sp)
    if donor is not None:
        out.donor_code = donor.code
        out.donor_name = donor.full_name
    if orphan is not None:
        out.orphan_code = orphan.code
        out.orphan_name = f"{orphan.first_name} {orphan.family_name}"
    return out


@router.get("", response_model=Page[SponsorshipRead])
async def list_sponsorships(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*FINANCE_ROLES))],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    donor_id: UUID | None = None,
    orphan_id: UUID | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    min_months_overdue: Annotated[int | None, Query(ge=0)] = None,
    is_overdue: bool | None = None,
) -> Page[SponsorshipRead]:
    # Explicit org scope (defense-in-depth alongside RLS).
    stmt = select(Sponsorship).where(Sponsorship.organization_id == user.organization_id)
    if donor_id:
        stmt = stmt.where(Sponsorship.donor_id == donor_id)
    if orphan_id:
        stmt = stmt.where(Sponsorship.orphan_id == orphan_id)
    if status_filter:
        stmt = stmt.where(Sponsorship.status == status_filter)

    # Overdue filters: `is_overdue=true` is shorthand for "at least one
    # month behind". Both forms restrict to active sponsorships so the
    # finance screen never surfaces cancelled/completed rows as overdue.
    threshold = min_months_overdue
    if is_overdue and threshold is None:
        threshold = 1
    if threshold is not None:
        stmt = stmt.where(
            Sponsorship.status == "active",
            Sponsorship.months_overdue >= threshold,
        )

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Sponsorship.created_at.desc()).limit(limit).offset(offset))
    ).all()

    # Batch-fetch donor + orphan rows for the page so we don't N+1.
    donor_ids = {r.donor_id for r in rows}
    orphan_ids = {r.orphan_id for r in rows}
    donors: Sequence[Donor] = (
        (await db.scalars(select(Donor).where(Donor.id.in_(donor_ids)))).all() if donor_ids else []
    )
    orphans: Sequence[Orphan] = (
        (await db.scalars(select(Orphan).where(Orphan.id.in_(orphan_ids)))).all()
        if orphan_ids
        else []
    )
    donor_by_id = {d.id: d for d in donors}
    orphan_by_id = {o.id: o for o in orphans}

    return Page(
        items=[
            _enrich(r, donor_by_id.get(r.donor_id), orphan_by_id.get(r.orphan_id)) for r in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=SponsorshipRead, status_code=status.HTTP_201_CREATED)
async def create_sponsorship(
    payload: SponsorshipCreate,
    db: DbSession,
    user: CurrentUser,
) -> SponsorshipRead:
    donor = await db.scalar(select(Donor).where(Donor.id == payload.donor_id))
    if donor is None:
        raise NotFound("Donor")
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == payload.orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")

    existing = await db.scalar(
        select(Sponsorship).where(
            Sponsorship.donor_id == payload.donor_id,
            Sponsorship.orphan_id == payload.orphan_id,
            Sponsorship.status.in_(ACTIVE_LIKE),
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active sponsorship already exists for this donor and orphan",
        )

    sponsorship = Sponsorship(
        organization_id=user.organization_id,
        code=generate_code("KAF"),
        donor_id=payload.donor_id,
        orphan_id=payload.orphan_id,
        monthly_amount=payload.monthly_amount,
        currency=payload.currency,
        start_date=payload.start_date,
        end_date=payload.end_date,
        payment_frequency=payload.payment_frequency,
        payment_method=payload.payment_method,
        next_payment_date=_next_monthly(payload.start_date),
        status="active",
        notes=payload.notes,
        created_by=user.id,
    )
    db.add(sponsorship)
    await db.commit()
    await db.refresh(sponsorship)
    return SponsorshipRead.model_validate(sponsorship)


_CSV_COLUMNS = (
    "code",
    "donor_id",
    "orphan_id",
    "monthly_amount",
    "currency",
    "payment_frequency",
    "status",
    "start_date",
    "end_date",
    "next_payment_date",
    "total_paid",
    "payments_count",
    "created_at",
)


@router.get("/export.csv")
async def export_sponsorships_csv(
    db: DbSession,
    _user: CurrentUser,
    donor_id: UUID | None = None,
    orphan_id: UUID | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> StreamingResponse:
    """Stream sponsorships matching the same filters as the list endpoint,
    as CSV. Registered before /{sponsorship_id} so FastAPI doesn't try
    to parse 'export.csv' as a UUID. Capped at 10 000 rows."""
    stmt = select(Sponsorship)
    if donor_id:
        stmt = stmt.where(Sponsorship.donor_id == donor_id)
    if orphan_id:
        stmt = stmt.where(Sponsorship.orphan_id == orphan_id)
    if status_filter:
        stmt = stmt.where(Sponsorship.status == status_filter)
    stmt = stmt.order_by(Sponsorship.created_at.desc()).limit(10_000)

    rows = (await db.scalars(stmt)).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_CSV_COLUMNS)
    for s in rows:
        writer.writerow(
            [
                s.code,
                str(s.donor_id),
                str(s.orphan_id),
                str(s.monthly_amount),
                s.currency,
                s.payment_frequency or "",
                s.status,
                s.start_date.isoformat() if s.start_date else "",
                s.end_date.isoformat() if s.end_date else "",
                s.next_payment_date.isoformat() if s.next_payment_date else "",
                str(s.total_paid or 0),
                s.payments_count or 0,
                s.created_at.isoformat(),
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="rufaqaa-sponsorships.csv"'},
    )


@router.get("/{sponsorship_id}", response_model=SponsorshipRead)
async def get_sponsorship(
    sponsorship_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> SponsorshipRead:
    sp = await db.scalar(select(Sponsorship).where(Sponsorship.id == sponsorship_id))
    if sp is None:
        raise NotFound("Sponsorship")
    donor = await db.scalar(select(Donor).where(Donor.id == sp.donor_id))
    orphan = await db.scalar(select(Orphan).where(Orphan.id == sp.orphan_id))
    return _enrich(sp, donor, orphan)


@router.patch("/{sponsorship_id}", response_model=SponsorshipRead)
async def update_sponsorship(
    sponsorship_id: UUID,
    payload: SponsorshipUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> SponsorshipRead:
    """Edit non-status fields on an active sponsorship.

    Cancelled / completed sponsorships are immutable so the historical
    record stays clean."""
    sp = await db.scalar(select(Sponsorship).where(Sponsorship.id == sponsorship_id))
    if sp is None:
        raise NotFound("Sponsorship")
    if sp.status in ("cancelled", "completed"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Sponsorship is {sp.status} — cannot edit",
        )
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(sp, field, value)
    await db.commit()
    await db.refresh(sp)
    return SponsorshipRead.model_validate(sp)


@router.post("/{sponsorship_id}/pause", response_model=SponsorshipRead)
async def pause_sponsorship(
    sponsorship_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> SponsorshipRead:
    sp = await db.scalar(select(Sponsorship).where(Sponsorship.id == sponsorship_id))
    if sp is None:
        raise NotFound("Sponsorship")
    if sp.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Can only pause active sponsorships (current: {sp.status})",
        )
    sp.status = "paused"
    await db.commit()
    await db.refresh(sp)
    return SponsorshipRead.model_validate(sp)


@router.post("/{sponsorship_id}/resume", response_model=SponsorshipRead)
async def resume_sponsorship(
    sponsorship_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> SponsorshipRead:
    sp = await db.scalar(select(Sponsorship).where(Sponsorship.id == sponsorship_id))
    if sp is None:
        raise NotFound("Sponsorship")
    if sp.status != "paused":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Can only resume paused sponsorships (current: {sp.status})",
        )
    sp.status = "active"
    await db.commit()
    await db.refresh(sp)
    return SponsorshipRead.model_validate(sp)


@router.post("/{sponsorship_id}/cancel", response_model=SponsorshipRead)
async def cancel_sponsorship(
    sponsorship_id: UUID,
    payload: SponsorshipCancel,
    db: DbSession,
    _user: CurrentUser,
) -> SponsorshipRead:
    sp = await db.scalar(select(Sponsorship).where(Sponsorship.id == sponsorship_id))
    if sp is None:
        raise NotFound("Sponsorship")
    if sp.status in ("cancelled", "completed"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Sponsorship already {sp.status}",
        )
    sp.status = "cancelled"
    sp.cancelled_at = datetime.now(UTC)
    sp.cancellation_reason = payload.reason
    await db.commit()
    await db.refresh(sp)
    return SponsorshipRead.model_validate(sp)
