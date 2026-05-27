"""Report publish → donor notification fan-out (idempotency).

The publish endpoint enqueues `notify_donors_of_report` on Celery. We
don't run a worker in the test environment, so we test the task body
directly: it must be a no-op on the second call (gated by
`donors_notified_at`).
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.workers.tasks import notifications


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1"
                )
            )
        ).first()
        assert row is not None
        return row[0]


async def _setup_report(api: AsyncClient, headers: dict[str, str]) -> tuple[str, str, str]:
    """Create donor + orphan + active sponsorship + draft → published
    report. Returns (donor_id, orphan_id, report_id)."""
    suffix = uuid.uuid4().hex[:6]
    partner_id = await _seed_partner_id()
    donor = (
        await api.post(
            "/api/v1/donors",
            json={
                "full_name": f"Sponsor {suffix}",
                "email": f"sponsor-{suffix}@example.com",
                "preferred_currency": "KWD",
            },
            headers=headers,
        )
    ).json()
    orphan = (
        await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"orph-{suffix}",
                "family_name": "test",
                "date_of_birth": "2014-01-01",
                "gender": "M",
                "partner_organization_id": partner_id,
                "father_name": "father",
            },
            headers=headers,
        )
    ).json()
    sp = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor["id"],
            "orphan_id": orphan["id"],
            "monthly_amount": "10.00",
            "currency": "KWD",
            "start_date": "2026-06-01",
        },
        headers=headers,
    )
    assert sp.status_code == 201
    # Move from pending → active so the notify-task picks it up.
    await api.post(
        f"/api/v1/sponsorships/{sp.json()['id']}/activate", headers=headers
    )

    r = await api.post(
        "/api/v1/reports",
        json={
            "orphan_id": orphan["id"],
            "report_type": "monthly",
            "period_start": "2026-04-01",
            "period_end": "2026-04-30",
            "summary": "Doing well.",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    # Walk the workflow → published.
    for step in (
        "submit",
        "approve-partner",
        "approve-org",
        "publish",
    ):
        rr = await api.post(f"/api/v1/reports/{rid}/{step}", headers=headers)
        assert rr.status_code == 200, (step, rr.text)
    return donor["id"], orphan["id"], rid


async def test_publish_marks_report_published(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    _donor, _orphan, rid = await _setup_report(api, auth_headers)
    r = await api.get(f"/api/v1/reports/{rid}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "published_to_donor"


async def test_notify_idempotency_helpers(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """We exercise the helpers directly because the Celery task body uses
    `asyncio.run`, which conflicts with the test's own running loop. The
    helpers are the unit of behaviour we care about: gating on
    `donors_notified_at` and stamping it on success."""
    _donor, _orphan, rid = await _setup_report(api, auth_headers)
    rid_uuid = uuid.UUID(rid)

    # Initially the report has not been notified.
    assert await notifications._already_notified(rid_uuid) is False

    # The donor list is non-empty (we created an active sponsorship in
    # `_setup_report`).
    recipients = await notifications._donor_emails_for_report(rid_uuid)
    assert len(recipients) >= 1

    # Stamp it.
    await notifications._stamp_notified(rid_uuid)
    assert await notifications._already_notified(rid_uuid) is True

    # The stamp is sticky — re-stamping is a no-op (does not overwrite).
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT donors_notified_at FROM orphan_reports WHERE id = :rid"
                ),
                {"rid": rid},
            )
        ).first()
        assert row is not None and row[0] is not None
    first_stamp = row[0]
    await notifications._stamp_notified(rid_uuid)
    async with make_session() as db:
        row2 = (
            await db.execute(
                text(
                    "SELECT donors_notified_at FROM orphan_reports WHERE id = :rid"
                ),
                {"rid": rid},
            )
        ).first()
    assert row2 is not None and row2[0] == first_stamp


async def test_donor_emails_for_unknown_report_is_empty(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    out = await notifications._donor_emails_for_report(uuid.uuid4())
    assert out == []
    _ = api, auth_headers
