"""Daily digest: one summary per organization for org_admins.

For each non-archived org, compute new payments / new sponsorships /
overdue counts for the last 24h, find admin emails, and emit one
structured log record per recipient. SMTP delivery will plug into the
same composition step later.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import func, select

from app.core.database import make_session
from app.models.organization import Organization
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.services.email import send_templated
from app.workers.celery_app import celery_app

logger = structlog.get_logger(__name__)


class DigestEntry:
    __slots__ = (
        "organization_id",
        "organization_name",
        "window_hours",
        "new_payments_count",
        "new_payments_total",
        "new_sponsorships_count",
        "overdue_sponsorships_count",
        "recipients",
    )

    def __init__(
        self,
        *,
        organization_id: UUID,
        organization_name: str,
        window_hours: int,
        new_payments_count: int,
        new_payments_total: Decimal,
        new_sponsorships_count: int,
        overdue_sponsorships_count: int,
        recipients: list[str],
    ) -> None:
        self.organization_id = organization_id
        self.organization_name = organization_name
        self.window_hours = window_hours
        self.new_payments_count = new_payments_count
        self.new_payments_total = new_payments_total
        self.new_sponsorships_count = new_sponsorships_count
        self.overdue_sponsorships_count = overdue_sponsorships_count
        self.recipients = recipients

    def as_dict(self) -> dict[str, Any]:
        return {
            "organization_id": str(self.organization_id),
            "organization_name": self.organization_name,
            "window_hours": self.window_hours,
            "new_payments_count": self.new_payments_count,
            "new_payments_total": str(self.new_payments_total),
            "new_sponsorships_count": self.new_sponsorships_count,
            "overdue_sponsorships_count": self.overdue_sponsorships_count,
            "recipients": self.recipients,
        }


async def compose_digest_for_org(org: Organization, window_hours: int = 24) -> DigestEntry:
    cutoff = datetime.now(UTC) - timedelta(hours=window_hours)
    async with make_session() as db:
        new_payments_count, new_payments_total = (
            await db.execute(
                select(
                    func.count(Payment.id),
                    func.coalesce(func.sum(Payment.amount), 0),
                ).where(
                    Payment.organization_id == org.id,
                    Payment.status == "completed",
                    Payment.completed_at >= cutoff,
                )
            )
        ).one()

        new_sponsorships_count = (
            await db.scalar(
                select(func.count(Sponsorship.id)).where(
                    Sponsorship.organization_id == org.id,
                    Sponsorship.created_at >= cutoff,
                )
            )
            or 0
        )
        overdue_sponsorships_count = (
            await db.scalar(
                select(func.count(Sponsorship.id)).where(
                    Sponsorship.organization_id == org.id,
                    Sponsorship.status == "overdue",
                )
            )
            or 0
        )
        admin_emails = (
            await db.scalars(
                select(User.email).where(
                    User.organization_id == org.id,
                    User.role.in_(("super_admin", "org_admin")),
                    User.status == "active",
                    User.deleted_at.is_(None),
                )
            )
        ).all()

    return DigestEntry(
        organization_id=org.id,
        organization_name=org.name_ar,
        window_hours=window_hours,
        new_payments_count=int(new_payments_count or 0),
        new_payments_total=Decimal(new_payments_total or 0),
        new_sponsorships_count=int(new_sponsorships_count),
        overdue_sponsorships_count=int(overdue_sponsorships_count),
        recipients=list(admin_emails),
    )


async def compose_daily_digests() -> list[DigestEntry]:
    async with make_session() as db:
        orgs = (await db.scalars(select(Organization))).all()
    return [await compose_digest_for_org(org) for org in orgs]


@celery_app.task(  # type: ignore[untyped-decorator]
    name="app.workers.tasks.digest.send_daily_digest"
)
def send_daily_digest() -> int:
    """Composes the digest per org and renders the bilingual email
    template for each recipient. Returns the total email count
    (attempted + logged-only)."""
    entries = asyncio.run(compose_daily_digests())
    today = datetime.now(UTC).date().isoformat()
    total = 0
    for entry in entries:
        logger.info("daily_digest", **entry.as_dict())
        for recipient in entry.recipients:
            send_templated(
                to=recipient,
                template="daily_digest",
                # No per-user locale yet; fall back to the org default.
                locale="ar",
                org_name=entry.organization_name,
                date=today,
                new_payments_count=entry.new_payments_count,
                new_payments_total=f"{entry.new_payments_total}",
                new_sponsorships_count=entry.new_sponsorships_count,
                overdue_sponsorships_count=entry.overdue_sponsorships_count,
            )
            total += 1
    return total
