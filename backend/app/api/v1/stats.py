"""Aggregate metrics for the dashboard.

A single endpoint returns headline counts so the frontend can render the
dashboard with one round trip. Numbers are scoped to the caller's
organization by an explicit ``organization_id`` filter on every aggregate
query — the app's superuser DB connection bypasses RLS, so the filter (not
RLS) is what keeps the dashboard per-tenant. The ``platform/*`` endpoints
below are the deliberate exception: super-admin-only and cross-org.
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.deps import DbSession
from app.core.authz import STAFF_ROLES, require_roles
from app.models.donor import Donor
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.platform import (
    CurrencyTotal,
    OrgRanking,
    PaymentMethodSlice,
    PlatformByOrg,
    PlatformFunnel,
    PlatformHeadline,
    PlatformMonthlyPoint,
    PlatformPaymentMethods,
    PlatformSummary,
    PlatformTimeseries,
)

router = APIRouter()

# Platform analytics are super-admin only and intentionally cross-org.
SuperAdmin = Annotated[User, Depends(require_roles("super_admin"))]


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
async def dashboard_summary(
    db: DbSession, user: Annotated[User, Depends(require_roles(*STAFF_ROLES))]
) -> DashboardSummary:
    thirty_days_ago = datetime.now(UTC) - timedelta(days=30)
    org_id = user.organization_id

    orphans_total = await db.scalar(
        select(func.count(Orphan.id)).where(
            Orphan.organization_id == org_id, Orphan.deleted_at.is_(None)
        )
    )
    orphans_sponsored = await db.scalar(
        select(func.count(Orphan.id)).where(
            Orphan.organization_id == org_id,
            Orphan.deleted_at.is_(None),
            Orphan.case_status == "sponsored",
        )
    )
    orphans_available = await db.scalar(
        select(func.count(Orphan.id)).where(
            Orphan.organization_id == org_id,
            Orphan.deleted_at.is_(None),
            Orphan.case_status == "available",
        )
    )
    donors_total = await db.scalar(
        select(func.count(Donor.id)).where(
            Donor.organization_id == org_id, Donor.deleted_at.is_(None)
        )
    )
    sponsorships_active = await db.scalar(
        select(func.count(Sponsorship.id)).where(
            Sponsorship.organization_id == org_id, Sponsorship.status == "active"
        )
    )
    sponsorships_overdue = await db.scalar(
        select(func.count(Sponsorship.id)).where(
            Sponsorship.organization_id == org_id, Sponsorship.status == "overdue"
        )
    )
    last_30 = await db.execute(
        select(
            func.coalesce(func.sum(Payment.amount), 0),
            func.count(Payment.id),
        ).where(
            Payment.organization_id == org_id,
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
async def payments_timeseries(
    db: DbSession, user: Annotated[User, Depends(require_roles(*STAFF_ROLES))]
) -> PaymentsTimeseries:
    """Total paid + count grouped by month for the last 12 months."""
    cutoff = datetime.now(UTC).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    ) - timedelta(days=365)
    month = func.date_trunc("month", Payment.completed_at).label("month")
    # Explicit org scope (superuser DB connection bypasses RLS).
    stmt = (
        select(
            month,
            func.coalesce(func.sum(Payment.amount), 0).label("total"),
            func.count(Payment.id).label("count"),
        )
        .where(
            Payment.organization_id == user.organization_id,
            Payment.status == "completed",
            Payment.completed_at >= cutoff,
        )
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
async def sponsorships_by_status(
    db: DbSession, user: Annotated[User, Depends(require_roles(*STAFF_ROLES))]
) -> SponsorshipsByStatus:
    """One row per status enum that currently has at least one
    sponsorship attached. The frontend renders this as a small donut."""
    # Explicit org scope (superuser DB connection bypasses RLS).
    rows = (
        await db.execute(
            select(Sponsorship.status, func.count(Sponsorship.id))
            .where(Sponsorship.organization_id == user.organization_id)
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
async def donations_by_partner(
    db: DbSession, user: Annotated[User, Depends(require_roles(*STAFF_ROLES))]
) -> DonationsByPartner:
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
            Payment.organization_id == user.organization_id,
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


# ═══════════════════════════════════════════════════════════════════
# Platform-wide analytics (super_admin only).
#
# These deliberately aggregate across EVERY organization, bypassing the
# per-tenant RLS scoping used by the dashboard endpoints above. They run
# with no `app.current_org_id` filter; the super_admin DB context is
# privileged to read all orgs' rows. ALL three are gated to super_admin
# (never org_admin, which is per-org).
# ═══════════════════════════════════════════════════════════════════


@router.get("/platform/summary", response_model=PlatformSummary)
async def platform_summary(db: DbSession, _admin: SuperAdmin) -> PlatformSummary:
    """Cross-org headline totals for the super-admin console. `total_donated`
    is reported both as a converted figure (sum of
    payments.amount_in_default_currency, where available) and as a
    per-currency breakdown so nothing is silently lost to FX gaps."""
    total_orgs = await db.scalar(select(func.count(Organization.id))) or 0
    active_orgs = (
        await db.scalar(select(func.count(Organization.id)).where(Organization.status == "active"))
        or 0
    )
    total_orphans = (
        await db.scalar(select(func.count(Orphan.id)).where(Orphan.deleted_at.is_(None))) or 0
    )
    total_donors = (
        await db.scalar(select(func.count(Donor.id)).where(Donor.deleted_at.is_(None))) or 0
    )
    total_sponsorships = await db.scalar(select(func.count(Sponsorship.id))) or 0

    converted = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount_in_default_currency), 0)).where(
            Payment.status == "completed"
        )
    )
    by_currency_rows = (
        await db.execute(
            select(Payment.currency, func.coalesce(func.sum(Payment.amount), 0))
            .where(Payment.status == "completed")
            .group_by(Payment.currency)
            .order_by(func.sum(Payment.amount).desc())
        )
    ).all()

    return PlatformSummary(
        total_orgs=int(total_orgs),
        active_orgs=int(active_orgs),
        total_orphans=int(total_orphans),
        total_donors=int(total_donors),
        total_sponsorships=int(total_sponsorships),
        total_donated_converted=Decimal(converted or 0),
        total_donated_by_currency=[
            CurrencyTotal(currency=str(c), total=Decimal(t or 0)) for c, t in by_currency_rows
        ],
    )


@router.get("/platform/timeseries", response_model=PlatformTimeseries)
async def platform_timeseries(db: DbSession, _admin: SuperAdmin) -> PlatformTimeseries:
    """Completed-payment totals + counts by month across ALL orgs, last
    12 months. Cross-org read gated to super_admin."""
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
    return PlatformTimeseries(
        months=[
            PlatformMonthlyPoint(
                month=r.month,
                payments_total=Decimal(r.total),
                payments_count=int(r._mapping["count"]),
            )
            for r in rows
        ]
    )


@router.get("/platform/by-org", response_model=PlatformByOrg)
async def platform_by_org(
    db: DbSession,
    _admin: SuperAdmin,
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
) -> PlatformByOrg:
    """Top N orgs by completed-donation total (with sponsorship counts).
    Cross-org read gated to super_admin."""
    donation_totals = (
        select(
            Payment.organization_id.label("org_id"),
            func.coalesce(func.sum(Payment.amount), 0).label("total"),
        )
        .where(Payment.status == "completed")
        .group_by(Payment.organization_id)
        .subquery()
    )
    sponsorship_counts = (
        select(
            Sponsorship.organization_id.label("org_id"),
            func.count(Sponsorship.id).label("cnt"),
        )
        .group_by(Sponsorship.organization_id)
        .subquery()
    )
    stmt = (
        select(
            Organization.id,
            Organization.code,
            Organization.name_ar,
            Organization.name_en,
            func.coalesce(sponsorship_counts.c.cnt, 0),
            func.coalesce(donation_totals.c.total, 0),
        )
        .outerjoin(donation_totals, donation_totals.c.org_id == Organization.id)
        .outerjoin(sponsorship_counts, sponsorship_counts.c.org_id == Organization.id)
        .order_by(func.coalesce(donation_totals.c.total, 0).desc(), Organization.code)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return PlatformByOrg(
        limit=limit,
        items=[
            OrgRanking(
                organization_id=r[0],
                code=r[1],
                name_ar=r[2],
                name_en=r[3],
                sponsorships_count=int(r[4]),
                donations_total=Decimal(r[5]),
            )
            for r in rows
        ],
    )


@router.get("/platform/headline", response_model=PlatformHeadline)
async def platform_headline(db: DbSession, _admin: SuperAdmin) -> PlatformHeadline:
    """Two headline figures for the super-admin console:

    * average sponsorship duration (whole days) over sponsorships that have
      already ended, and
    * the in-platform DONOR ACTIVATION rate — the share of (non-deleted)
      donors who created at least one sponsorship.

    The activation rate is deliberately NOT a visitor→donor conversion: the
    platform has no visitor/event tracking, so we only report behaviour we
    can actually observe. Cross-org read gated to super_admin.
    """
    # `end_date - start_date` is integer days in Postgres; AVG yields a
    # Decimal we round to whole days. NULL (no ended sponsorships) → None.
    avg_days = await db.scalar(
        select(func.avg(Sponsorship.end_date - Sponsorship.start_date)).where(
            Sponsorship.end_date.is_not(None)
        )
    )
    total_donors = (
        await db.scalar(select(func.count(Donor.id)).where(Donor.deleted_at.is_(None))) or 0
    )
    donors_with_sponsorship = (
        await db.scalar(select(func.count(Sponsorship.donor_id.distinct()))) or 0
    )

    return PlatformHeadline(
        avg_sponsorship_duration_days=(int(round(avg_days)) if avg_days is not None else None),
        donor_conversion_rate=(donors_with_sponsorship / total_donors if total_donors else 0.0),
    )


@router.get("/platform/funnel", response_model=PlatformFunnel)
async def platform_funnel(db: DbSession, _admin: SuperAdmin) -> PlatformFunnel:
    """In-platform donor-activation funnel across ALL orgs: registered
    donors → donors who created a sponsorship → donors with an active
    sponsorship. Honest about what the data supports — there is no
    visitor/lead stage because nothing tracks pre-registration. Cross-org
    read gated to super_admin."""
    registered_donors = (
        await db.scalar(select(func.count(Donor.id)).where(Donor.deleted_at.is_(None))) or 0
    )
    donors_with_sponsorship = (
        await db.scalar(select(func.count(Sponsorship.donor_id.distinct()))) or 0
    )
    donors_with_active_sponsorship = (
        await db.scalar(
            select(func.count(Sponsorship.donor_id.distinct())).where(
                Sponsorship.status == "active"
            )
        )
        or 0
    )
    return PlatformFunnel(
        registered_donors=int(registered_donors),
        donors_with_sponsorship=int(donors_with_sponsorship),
        donors_with_active_sponsorship=int(donors_with_active_sponsorship),
    )


@router.get("/platform/payment-methods", response_model=PlatformPaymentMethods)
async def platform_payment_methods(db: DbSession, _admin: SuperAdmin) -> PlatformPaymentMethods:
    """Completed payments grouped by payment method across ALL orgs: count
    and summed amount per method, ordered by total descending. Cross-org
    read gated to super_admin."""
    rows = (
        await db.execute(
            select(
                Payment.payment_method,
                func.count(Payment.id),
                func.coalesce(func.sum(Payment.amount), 0),
            )
            .where(Payment.status == "completed")
            .group_by(Payment.payment_method)
            .order_by(func.coalesce(func.sum(Payment.amount), 0).desc())
        )
    ).all()
    return PlatformPaymentMethods(
        items=[
            PaymentMethodSlice(method=str(r[0]), count=int(r[1]), total=Decimal(r[2] or 0))
            for r in rows
        ]
    )
