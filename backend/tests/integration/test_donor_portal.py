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
