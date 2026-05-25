"""Email-notification helper test.

We exercise the donor-lookup helper directly. A full publish-then-receive
flight would need a running SMTP target (MailHog), so the actual send
path is left for the local docker-compose smoke test.
"""

from __future__ import annotations

import uuid
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.workers.tasks.notifications import _donor_emails_for_report


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def test_donor_emails_helper_returns_active_sponsors(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    suffix = uuid.uuid4().hex[:6]
    partner_id = await _seed_partner_id()
    email = f"notify-{suffix}@example.com"

    donor = (
        await api.post(
            "/api/v1/donors",
            json={"full_name": "كافل إشعار", "email": email},
            headers=auth_headers,
        )
    ).json()
    orphan = (
        await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"تقرير-{suffix}",
                "family_name": "إشعار",
                "date_of_birth": "2016-09-09",
                "gender": "F",
                "partner_organization_id": partner_id,
                "father_name": f"أب-{suffix}",
            },
            headers=auth_headers,
        )
    ).json()
    await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor["id"],
            "orphan_id": orphan["id"],
            "monthly_amount": "10.00",
            "currency": "KWD",
            "start_date": "2026-06-01",
        },
        headers=auth_headers,
    )
    report = (
        await api.post(
            "/api/v1/reports",
            json={
                "orphan_id": orphan["id"],
                "report_type": "monthly",
                "period_start": "2026-05-01",
                "period_end": "2026-05-31",
            },
            headers=auth_headers,
        )
    ).json()

    recipients = await _donor_emails_for_report(UUID(report["id"]))
    assert (email, "كافل إشعار") in recipients
