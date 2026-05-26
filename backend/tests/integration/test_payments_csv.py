"""CSV export of /payments."""

from __future__ import annotations

from httpx import AsyncClient


async def test_export_csv_returns_csv_payload(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/payments/export.csv", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert "text/csv" in r.headers["content-type"]
    body = r.text
    # First line is the header row.
    first_line = body.splitlines()[0]
    for col in ("code", "donor_id", "amount", "currency", "status"):
        assert col in first_line


async def test_export_csv_respects_status_filter(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/payments/export.csv?status=completed", headers=auth_headers)
    assert r.status_code == 200
    lines = r.text.splitlines()
    # Header + any number of data rows; every data row's status column must be 'completed'.
    for line in lines[1:]:
        # status column is index 8 in _CSV_COLUMNS
        assert ",completed," in f",{line},"
