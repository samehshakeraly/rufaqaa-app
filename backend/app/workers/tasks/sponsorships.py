"""Sponsorship-related background tasks."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, date, datetime
from typing import Any, cast

from sqlalchemy import update

from app.core.database import make_session
from app.models.sponsorship import Sponsorship
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


async def _mark_overdue_async(today: date) -> int:
    """Flip every active sponsorship whose next_payment_date is in the past
    to status='overdue' and bump months_overdue by 1.

    Returns the number of rows updated.
    """
    async with make_session() as db:
        result = await db.execute(
            update(Sponsorship)
            .where(
                Sponsorship.status == "active",
                Sponsorship.next_payment_date.is_not(None),
                Sponsorship.next_payment_date < today,
            )
            .values(
                status="overdue",
                months_overdue=Sponsorship.months_overdue + 1,
                updated_at=datetime.now(UTC),
            )
        )
        await db.commit()
        # `result.rowcount` exists on CursorResult — narrow via cast.
        from sqlalchemy.engine import CursorResult

        return cast(CursorResult[Any], result).rowcount or 0


@celery_app.task(  # type: ignore[untyped-decorator]
    name="app.workers.tasks.sponsorships.mark_overdue_sponsorships"
)
def mark_overdue_sponsorships(today_iso: str | None = None) -> dict[str, int | str]:
    """Daily scheduled task: mark active sponsorships whose payment is due."""
    today = date.fromisoformat(today_iso) if today_iso else date.today()
    count = asyncio.run(_mark_overdue_async(today))
    logger.info("Marked %s sponsorship(s) overdue as of %s", count, today.isoformat())
    return {"date": today.isoformat(), "marked_overdue": count}
