import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def _make_orphan(api: AsyncClient, h: dict[str, str]) -> str:
    partner_id = await _seed_partner_id()
    unique = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"رحمة-{unique}",
            "family_name": "تقرير",
            "date_of_birth": "2014-04-04",
            "gender": "F",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{unique}",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_report_full_workflow(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id = await _make_orphan(api, auth_headers)

    payload = {
        "orphan_id": orphan_id,
        "report_type": "monthly",
        "period_start": "2026-05-01",
        "period_end": "2026-05-31",
        "summary": "تقدّم جيد",
        "educational_progress": {"grade": "ممتاز"},
    }
    r = await api.post("/api/v1/reports", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    report = r.json()
    rid = report["id"]
    assert report["status"] == "draft"

    expected = [
        ("submit", "pending_partner_approval"),
        ("approve-partner", "pending_org_approval"),
        ("approve-org", "org_approved"),
        ("publish", "published_to_donor"),
    ]
    for action, expected_status in expected:
        r = await api.post(f"/api/v1/reports/{rid}/{action}", json={}, headers=auth_headers)
        assert r.status_code == 200, f"{action} failed: {r.text}"
        assert r.json()["status"] == expected_status

    # bad transition after publish
    r = await api.post(f"/api/v1/reports/{rid}/submit", json={}, headers=auth_headers)
    assert r.status_code == 409

    # listing by status — filter to this orphan to keep the search bounded
    r = await api.get(
        f"/api/v1/reports?status=published_to_donor&orphan_id={orphan_id}",
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert any(item["id"] == rid for item in r.json()["items"])


async def test_report_reject_breaks_the_workflow(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    r = await api.post(
        "/api/v1/reports",
        json={
            "orphan_id": orphan_id,
            "report_type": "monthly",
            "period_start": "2026-06-01",
            "period_end": "2026-06-30",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201
    rid = r.json()["id"]

    r = await api.post(
        f"/api/v1/reports/{rid}/reject",
        json={"reason": "incomplete"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"
    assert r.json()["rejection_reason"] == "incomplete"

    # subsequent transitions from rejected fail
    r = await api.post(f"/api/v1/reports/{rid}/approve-partner", json={}, headers=auth_headers)
    assert r.status_code == 409


async def test_report_period_validation(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    r = await api.post(
        "/api/v1/reports",
        json={
            "orphan_id": orphan_id,
            "report_type": "monthly",
            "period_start": "2026-06-30",
            "period_end": "2026-06-01",
        },
        headers=auth_headers,
    )
    assert r.status_code == 400
