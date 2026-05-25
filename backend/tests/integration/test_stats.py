from httpx import AsyncClient


async def test_summary_returns_all_keys(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get("/api/v1/stats/summary", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    for key in (
        "orphans_total",
        "orphans_sponsored",
        "orphans_available",
        "donors_total",
        "sponsorships_active",
        "sponsorships_overdue",
        "payments_last_30d_total",
        "payments_last_30d_count",
    ):
        assert key in body
    # All previous tests have run, so we know totals are non-negative ints.
    assert body["orphans_total"] >= 0
    assert body["donors_total"] >= 0


async def test_summary_requires_auth(api: AsyncClient) -> None:
    r = await api.get("/api/v1/stats/summary")
    assert r.status_code == 401
