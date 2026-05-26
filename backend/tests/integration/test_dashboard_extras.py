"""GET /stats/sponsorships-by-status + /stats/donations-by-partner."""

from __future__ import annotations

from httpx import AsyncClient


async def test_sponsorships_by_status_shape(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get("/api/v1/stats/sponsorships-by-status", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert "slices" in body
    for s in body["slices"]:
        assert isinstance(s["status"], str)
        assert isinstance(s["count"], int)
        assert s["count"] >= 0


async def test_donations_by_partner_shape(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get("/api/v1/stats/donations-by-partner", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["window_days"] == 90
    assert isinstance(body["items"], list)
    assert len(body["items"]) <= 10
    for it in body["items"]:
        assert {
            "partner_id",
            "partner_code",
            "partner_name",
            "payments_total",
            "payments_count",
        } <= it.keys()
