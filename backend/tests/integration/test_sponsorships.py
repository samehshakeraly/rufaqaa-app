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


async def _create_donor(api: AsyncClient, auth_headers: dict[str, str]) -> str:
    payload = {
        "full_name": "كافل تجريبي",
        "email": f"sp-donor-{uuid.uuid4().hex[:8]}@example.com",
        "preferred_currency": "KWD",
    }
    r = await api.post("/api/v1/donors", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_orphan(api: AsyncClient, auth_headers: dict[str, str]) -> str:
    partner_id = await _seed_partner_id()
    unique = uuid.uuid4().hex[:6]
    payload = {
        "first_name": f"كفيل-{unique}",
        "family_name": "تجربة",
        "date_of_birth": "2016-01-20",
        "gender": "F",
        "partner_organization_id": partner_id,
        "father_name": f"أب-{unique}",
    }
    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_sponsorship_full_lifecycle(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    donor_id = await _create_donor(api, auth_headers)
    orphan_id = await _create_orphan(api, auth_headers)

    payload = {
        "donor_id": donor_id,
        "orphan_id": orphan_id,
        "monthly_amount": "25.00",
        "currency": "KWD",
        "start_date": "2026-06-01",
        "payment_frequency": "monthly",
        "payment_method": "knet",
    }
    r = await api.post("/api/v1/sponsorships", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    created = r.json()
    sp_id = created["id"]
    assert created["code"].startswith("KAF-")
    assert created["status"] == "active"
    assert created["next_payment_date"] == "2026-07-01"

    # duplicate active sponsorship rejected
    r2 = await api.post("/api/v1/sponsorships", json=payload, headers=auth_headers)
    assert r2.status_code == 409, r2.text

    # filter list by donor
    r3 = await api.get(f"/api/v1/sponsorships?donor_id={donor_id}", headers=auth_headers)
    assert r3.status_code == 200
    page = r3.json()
    assert any(s["id"] == sp_id for s in page["items"])

    # cancel
    r4 = await api.post(
        f"/api/v1/sponsorships/{sp_id}/cancel",
        json={"reason": "test"},
        headers=auth_headers,
    )
    assert r4.status_code == 200, r4.text
    assert r4.json()["status"] == "cancelled"

    # double cancel rejected
    r5 = await api.post(f"/api/v1/sponsorships/{sp_id}/cancel", json={}, headers=auth_headers)
    assert r5.status_code == 409

    # after cancelling, a NEW sponsorship with same donor/orphan is allowed
    r6 = await api.post("/api/v1/sponsorships", json=payload, headers=auth_headers)
    assert r6.status_code == 201, r6.text
    assert r6.json()["status"] == "active"


async def test_sponsorship_rejects_unknown_donor(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _create_orphan(api, auth_headers)
    payload = {
        "donor_id": str(uuid.uuid4()),
        "orphan_id": orphan_id,
        "monthly_amount": "10.00",
        "currency": "KWD",
        "start_date": "2026-06-01",
    }
    r = await api.post("/api/v1/sponsorships", json=payload, headers=auth_headers)
    assert r.status_code == 404
