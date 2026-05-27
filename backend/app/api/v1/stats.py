"""Aggregate metrics for the dashboard.

A single endpoint returns headline counts so the frontend can render the
dashboard with one round trip. Numbers are scoped by RLS (the
organization the caller belongs to).
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.models.donor import Donor
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship

router = APIRouter()


class DashboardSummary(BaseModel):
    orphans_total: int
    orphans_sponsored: int
    orphans_available: int
    donors_total: int
    sponsorships_active: int
    sponsorships_overdue: int
    payments_last_30d_total: Decimal
    payments_last_30d_count: int


@router.get("/summary", response_model=DashboardSummary)
async def dashboard_summary(db: DbSession, _user: CurrentUser) -> DashboardSummary:
    thirty_days_ago = datetime.now(UTC) - timedelta(days=30)

    orphans_total = await db.scalar(
        select(func.count(Orphan.id)).where(Orphan.deleted_at.is_(None))
    )
    orphans_sponsored = await db.scalar(
        select(func.count(Orphan.id)).where(
            Orphan.deleted_at.is_(None), Orphan.case_status == "sponsored"
        )
    )
    orphans_available = await db.scalar(
        select(func.count(Orphan.id)).where(
            Orphan.deleted_at.is_(None), Orphan.case_status == "available"
        )
    )
    donors_total = await db.scalar(select(func.count(Donor.id)).where(Donor.deleted_at.is_(None)))
    sponsorships_active = await db.scalar(
        select(func.count(Sponsorship.id)).where(Sponsorship.status == "active")
    )
    sponsorships_overdue = await db.scalar(
        select(func.count(Sponsorship.id)).where(Sponsorship.status == "overdue")
    )
    last_30 = await db.execute(
        select(
            func.coalesce(func.sum(Payment.amount), 0),
            func.count(Payment.id),
        ).where(
            Payment.status == "completed",
            Payment.completed_at >= thirty_days_ago,
        )
    )
    pay_sum, pay_count = last_30.one()

    return DashboardSummary(
        orphans_total=orphans_total or 0,
        orphans_sponsored=orphans_sponsored or 0,
        orphans_available=orphans_available or 0,
        donors_total=donors_total or 0,
        sponsorships_active=sponsorships_active or 0,
        sponsorships_overdue=sponsorships_overdue or 0,
        payments_last_30d_total=Decimal(pay_sum or 0),
        payments_last_30d_count=pay_count or 0,
    )


class MonthlyPoint(BaseModel):
    month: date  # first day of the month
    payments_total: Decimal
    payments_count: int


class PaymentsTimeseries(BaseModel):
    months: list[MonthlyPoint]


@router.get("/payments-timeseries", response_model=PaymentsTimeseries)
async def payments_timeseries(db: DbSession, _user: CurrentUser) -> PaymentsTimeseries:
    """Total paid + count grouped by month for the last 12 months."""
    cutoff = datetime.now(UTC).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    ) - timedelta(days=365)
    month = func.date_trunc("month", Payment.completed_at).label("month")
    stmt = (
        select(
            month,
            func.coalesce(func.sum(Payment.amount), 0).label("total"),
            func.count(Payment.id).label("count"),
        )
        .where(Payment.status == "completed", Payment.completed_at >= cutoff)
        .group_by(month)
        .order_by(month)
    )
    rows = (await db.execute(stmt)).all()
    return PaymentsTimeseries(
        months=[
            MonthlyPoint(
                month=r.month.date() if hasattr(r.month, "date") else r.month,
                payments_total=Decimal(r.total),
                payments_count=int(r._mapping["count"]),
            )
            for r in rows
        ]
    )


class StatusSlice(BaseModel):
    status: str
    count: int


class SponsorshipsByStatus(BaseModel):
    slices: list[StatusSlice]


@router.get("/sponsorships-by-status", response_model=SponsorshipsByStatus)
async def sponsorships_by_status(db: DbSession, _user: CurrentUser) -> SponsorshipsByStatus:
    """One row per status enum that currently has at least one
    sponsorship attached. The frontend renders this as a small donut."""
    rows = (
        await db.execute(
            select(Sponsorship.status, func.count(Sponsorship.id))
            .group_by(Sponsorship.status)
            .order_by(Sponsorship.status)
        )
    ).all()
    return SponsorshipsByStatus(
        slices=[StatusSlice(status=str(r[0]), count=int(r[1])) for r in rows]
    )


class PartnerDonations(BaseModel):
    partner_id: UUID
    partner_code: str
    partner_name: str
    payments_total: Decimal
    payments_count: int


class DonationsByPartner(BaseModel):
    window_days: int
    items: list[PartnerDonations]


@router.get("/donations-by-partner", response_model=DonationsByPartner)
async def donations_by_partner(db: DbSession, _user: CurrentUser) -> DonationsByPartner:
    """Completed payments rolled up by the orphan's partner
    organization over the last 90 days. Top 10 partners by total,
    descending. Payments not linked to an orphan (e.g. general
    donations) are skipped."""
    window_days = 90
    cutoff = datetime.now(UTC) - timedelta(days=window_days)
    stmt = (
        select(
            PartnerOrganization.id,
            PartnerOrganization.code,
            PartnerOrganization.name_ar,
            func.coalesce(func.sum(Payment.amount), 0).label("total"),
            func.count(Payment.id).label("count"),
        )
        .join(Orphan, Orphan.partner_organization_id == PartnerOrganization.id)
        .join(Payment, Payment.orphan_id == Orphan.id)
        .where(
            Payment.status == "completed",
            Payment.completed_at >= cutoff,
            Orphan.deleted_at.is_(None),
        )
        .group_by(PartnerOrganization.id, PartnerOrganization.code, PartnerOrganization.name_ar)
        .order_by(func.sum(Payment.amount).desc())
        .limit(10)
    )
    rows = (await db.execute(stmt)).all()
    return DonationsByPartner(
        window_days=window_days,
        items=[
            PartnerDonations(
                partner_id=r[0],
                partner_code=r[1],
                partner_name=r[2],
                payments_total=Decimal(r[3]),
                payments_count=int(r[4]),
            )
            for r in rows
        ],
    )
