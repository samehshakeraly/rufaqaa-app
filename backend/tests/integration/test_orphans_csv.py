"""CSV export of /orphans."""

from __future__ import annotations

from httpx import AsyncClient


async def test_orphans_export_csv_returns_csv(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/orphans/export.csv", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert "text/csv" in r.headers["content-type"]
    first_line = r.text.splitlines()[0]
    for col in ("code", "first_name", "family_name", "case_status", "current_balance"):
        assert col in first_line


async def test_orphans_export_csv_respects_case_status_filter(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/orphans/export.csv?case_status=pending_review", headers=auth_headers)
    assert r.status_code == 200
    lines = r.text.splitlines()
    for line in lines[1:]:
        assert ",pending_review," in f",{line},"
