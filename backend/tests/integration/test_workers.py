"""Celery task integration tests.

We invoke the task function synchronously (bypassing the broker) and
assert the side effects on the database. The Celery decorator does not
change call semantics for direct invocation.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.workers.tasks.sponsorships import _mark_overdue_async


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def _setup_sponsorship_with_due_date(
    api: AsyncClient, h: dict[str, str], next_payment: date
) -> str:
    """Create donor + orphan + sponsorship, then force next_payment_date
    to an arbitrary value (the create endpoint computes its own)."""
    suffix = uuid.uuid4().hex[:8]
    donor = await api.post(
        "/api/v1/donors",
        json={"full_name": "كافل", "email": f"overdue-{suffix}@example.com"},
        headers=h,
    )
    assert donor.status_code == 201, donor.text

    partner_id = await _seed_partner_id()
    orphan = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"يتيم-{suffix}",
            "family_name": "متأخر",
            "date_of_birth": "2015-07-20",
            "gender": "M",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{suffix}",
        },
        headers=h,
    )
    assert orphan.status_code == 201, orphan.text

    sp = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor.json()["id"],
            "orphan_id": orphan.json()["id"],
            "monthly_amount": "15.00",
            "currency": "KWD",
            "start_date": "2026-01-01",
        },
        headers=h,
    )
    assert sp.status_code == 201, sp.text
    sp_id = sp.json()["id"]

    # Force the due date so the task has something to grab.
    async with make_session() as db:
        from uuid import UUID

        from sqlalchemy import update as sa_update

        from app.models.sponsorship import Sponsorship as _Sp

        await db.execute(
            sa_update(_Sp).where(_Sp.id == UUID(sp_id)).values(next_payment_date=next_payment),
        )
        await db.commit()
    return sp_id


async def test_mark_overdue_flips_past_due_sponsorships(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    today = date(2026, 6, 15)
    overdue_id = await _setup_sponsorship_with_due_date(
        api, auth_headers, today - timedelta(days=10)
    )
    fresh_id = await _setup_sponsorship_with_due_date(api, auth_headers, today + timedelta(days=5))

    # Invoke the inner async helper directly. The Celery wrapper uses
    # asyncio.run() which would clash with pytest-asyncio's running loop;
    # the wrapper itself is exercised by the worker container in real use.
    count = await _mark_overdue_async(today)
    assert count >= 1

    # The past-due one is overdue
    r = await api.get(f"/api/v1/sponsorships/{overdue_id}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "overdue"

    # The future-due one stays active
    r = await api.get(f"/api/v1/sponsorships/{fresh_id}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "active"
