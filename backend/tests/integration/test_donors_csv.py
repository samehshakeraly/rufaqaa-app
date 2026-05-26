"""CSV export of /donors."""

from __future__ import annotations

from httpx import AsyncClient


async def test_donors_export_csv_returns_csv(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/donors/export.csv", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert "text/csv" in r.headers["content-type"]
    first_line = r.text.splitlines()[0]
    for col in ("code", "full_name", "email", "status", "total_donated"):
        assert col in first_line
