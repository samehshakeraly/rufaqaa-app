from httpx import AsyncClient


async def test_timeseries_returns_list(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get("/api/v1/stats/payments-timeseries", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "months" in body and isinstance(body["months"], list)
    for point in body["months"]:
        # Each entry is shaped (month, payments_total, payments_count)
        assert {"month", "payments_total", "payments_count"} <= point.keys()
        assert int(point["payments_count"]) >= 0


async def test_timeseries_requires_auth(api: AsyncClient) -> None:
    r = await api.get("/api/v1/stats/payments-timeseries")
    assert r.status_code == 401
