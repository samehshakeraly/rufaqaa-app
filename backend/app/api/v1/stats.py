"""Aggregate metrics for the dashboard.

A single endpoint returns headline counts so the frontend can render the
dashboard with one round trip. Numbers are scoped by RLS (the
organization the caller belongs to).
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.models.donor import Donor
from app.models.orphan import Orphan
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
                payments_count=int(r.count),
            )
            for r in rows
        ]
    )
