"""Donor portal — /me/sponsorships and /me/reports."""

from __future__ import annotations

import uuid

from httpx import AsyncClient


async def test_admin_must_supply_donor_id(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get("/api/v1/me/sponsorships", headers=auth_headers)
    assert r.status_code == 400


async def test_admin_views_specific_donor(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    # Pick any existing donor — earlier tests created plenty.
    donors_page = (await api.get("/api/v1/donors?limit=1", headers=auth_headers)).json()
    if donors_page["total"] == 0:
        # Brand-new DB; create one so the test still has something to chew on.
        r = await api.post(
            "/api/v1/donors",
            json={
                "full_name": "portal",
                "email": f"portal-{uuid.uuid4().hex[:6]}@example.com",
            },
            headers=auth_headers,
        )
        assert r.status_code == 201
        donor_id = r.json()["id"]
    else:
        donor_id = donors_page["items"][0]["id"]

    r = await api.get(f"/api/v1/me/sponsorships?donor_id={donor_id}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["total"] >= 0

    r = await api.get(f"/api/v1/me/reports?donor_id={donor_id}", headers=auth_headers)
    assert r.status_code == 200
    # Every returned report is in the published_to_donor state.
    for item in r.json()["items"]:
        assert item["status"] == "published_to_donor"


async def test_admin_unknown_donor_id_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get(f"/api/v1/me/sponsorships?donor_id={uuid.uuid4()}", headers=auth_headers)
    assert r.status_code == 404


# ── PR-D06 follow-up: orphan_name / orphan_code on /me/sponsorships ────
#
# The donor portal's "My Orphans" page renders the child's name and code
# straight from this endpoint, so both must arrive filled — via ONE batch
# join per page, and exposing nothing about the child beyond that
# donor-approved slice.


async def _signup_and_verify(api: AsyncClient) -> dict[str, str]:
    """Self-signup donor, fully verified. Returns auth headers."""
    email = f"dp-{uuid.uuid4().hex[:8]}@example.com"
    r = await api.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "longenoughpw1", "full_name": "Portal Donor"},
    )
    token = r.json()["debug_verify_token"]
    r = await api.post("/api/v1/auth/verify-email", json={"token": token})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _make_available_orphan(api: AsyncClient, headers: dict[str, str], first_name: str) -> str:
    """Admin provisions an orphan and flips its case to 'available'."""
    from sqlalchemy import text

    from app.core.database import make_session

    partner_id = (await api.get("/api/v1/partners", headers=headers)).json()["items"][0]["id"]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": first_name,
            "family_name": "x",
            "date_of_birth": "2017-06-15",
            "gender": "F",
            "nationality": "KW",
            "father_name": "Test Father",
            "partner_organization_id": partner_id,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    code = r.json()["code"]
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status='available' WHERE code=:c"),
            {"c": code},
        )
        await db.commit()
    return code


async def _sponsor(api: AsyncClient, donor_headers: dict[str, str], orphan_code: str) -> None:
    r = await api.post(
        "/api/v1/donor/me/sponsorships",
        json={
            "orphan_code": orphan_code,
            "monthly_amount": "25.00",
            "currency": "KWD",
            "frequency": "monthly",
        },
        headers=donor_headers,
    )
    assert r.status_code == 201, r.text


async def test_my_sponsorships_carries_orphan_name_and_code(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    first_name = f"Named{uuid.uuid4().hex[:4]}"
    code = await _make_available_orphan(api, auth_headers, first_name)
    donor_headers = await _signup_and_verify(api)
    await _sponsor(api, donor_headers, code)

    r = await api.get("/api/v1/me/sponsorships", headers=donor_headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    item = items[0]
    # The whole point of the batch join: both fields arrive filled.
    assert item["orphan_code"] == code
    assert item["orphan_name"]
    assert first_name in item["orphan_name"]
    # And ONLY the approved slice — no orphan field beyond name + code
    # leaks into the sponsorship payload.
    for forbidden in ("date_of_birth", "nationality", "father_name", "case_status", "gender"):
        assert forbidden not in item


async def test_my_sponsorships_isolation_no_foreign_orphan_name(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A donor's /me/sponsorships must never surface the name or code of a
    child sponsored by someone else."""
    mine_name = f"Mine{uuid.uuid4().hex[:4]}"
    other_name = f"Other{uuid.uuid4().hex[:4]}"
    mine_code = await _make_available_orphan(api, auth_headers, mine_name)
    other_code = await _make_available_orphan(api, auth_headers, other_name)

    donor_a = await _signup_and_verify(api)
    donor_b = await _signup_and_verify(api)
    await _sponsor(api, donor_a, mine_code)
    await _sponsor(api, donor_b, other_code)

    r = await api.get("/api/v1/me/sponsorships", headers=donor_a)
    assert r.status_code == 200
    body = r.text
    items = r.json()["items"]
    # Donor A sees exactly their own child, by name and code…
    assert [i["orphan_code"] for i in items] == [mine_code]
    assert mine_name in body
    # …and nothing of donor B's child appears anywhere in the response.
    assert other_code not in body
    assert other_name not in body
