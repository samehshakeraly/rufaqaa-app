"""CSV export of /sponsorships."""

from __future__ import annotations

from httpx import AsyncClient


async def test_sponsorships_export_csv_returns_csv(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/sponsorships/export.csv", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert "text/csv" in r.headers["content-type"]
    first_line = r.text.splitlines()[0]
    for col in ("code", "donor_id", "orphan_id", "monthly_amount", "status"):
        assert col in first_line


async def test_sponsorships_export_csv_respects_status_filter(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/sponsorships/export.csv?status=active", headers=auth_headers)
    assert r.status_code == 200
    lines = r.text.splitlines()
    for line in lines[1:]:
        assert ",active," in f",{line},"
