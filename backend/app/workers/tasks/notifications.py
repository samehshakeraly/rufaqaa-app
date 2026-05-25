"""Notification tasks.

These run on the Celery worker so the publish endpoint can return
immediately while emails go out in the background.
"""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from sqlalchemy import select

from app.core.database import make_session
from app.models.donor import Donor
from app.models.report import OrphanReport
from app.models.sponsorship import Sponsorship
from app.services.email import send_email
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


async def _donor_emails_for_report(report_id: UUID) -> list[tuple[str, str]]:
    """Return (donor_email, donor_name) for every active sponsor of the
    orphan referenced by `report_id`."""
    async with make_session() as db:
        report = await db.scalar(select(OrphanReport).where(OrphanReport.id == report_id))
        if report is None:
            return []
        sponsorships = (
            await db.scalars(
                select(Sponsorship).where(
                    Sponsorship.orphan_id == report.orphan_id,
                    Sponsorship.status.in_(("active", "paused", "overdue")),
                )
            )
        ).all()
        if not sponsorships:
            return []
        donor_ids = {sp.donor_id for sp in sponsorships}
        donors = (await db.scalars(select(Donor).where(Donor.id.in_(donor_ids)))).all()
        return [(d.email, d.full_name) for d in donors if d.email]


@celery_app.task(name="app.workers.tasks.notifications.notify_donors_of_report")
def notify_donors_of_report(report_id: str) -> dict[str, int | str]:
    """Email each donor sponsoring this orphan that a new report is live."""
    recipients = asyncio.run(_donor_emails_for_report(UUID(report_id)))
    for email, name in recipients:
        try:
            send_email(
                to=email,
                subject="A new report on the orphan you sponsor is available",
                body=(
                    f"Dear {name},\n\n"
                    "A new periodic report for an orphan you sponsor has been "
                    "published. Sign in to https://rufaqaa.app to read it.\n\n"
                    "— Rufaqaa"
                ),
            )
        except Exception as exc:  # noqa: BLE001
            # Best-effort: one bad recipient must not abort the rest.
            logger.warning("Failed to email %s: %s", email, exc)
    logger.info("Notified %d donor(s) of report %s", len(recipients), report_id)
    return {"report_id": report_id, "notified": len(recipients)}
