"""Daily digest composition."""

from __future__ import annotations

from sqlalchemy import select

from app.core.database import make_session
from app.models.organization import Organization
from app.workers.tasks.digest import compose_digest_for_org


async def test_digest_seeded_org_has_admin_recipients() -> None:
    async with make_session() as db:
        org = await db.scalar(select(Organization).where(Organization.code == "DEV"))
    assert org is not None
    entry = await compose_digest_for_org(org)
    # Shape
    assert entry.organization_id == org.id
    assert entry.window_hours == 24
    assert entry.new_payments_count >= 0
    assert entry.new_sponsorships_count >= 0
    assert entry.overdue_sponsorships_count >= 0
    # Seeded admin is org_admin → must be one of the recipients
    assert "admin@dev.rufaqaa.app" in entry.recipients
