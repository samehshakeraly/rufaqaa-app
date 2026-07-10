"""GET/PATCH /organization."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.database import make_session


async def test_get_current_organization_returns_seed_org(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/organization", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["code"] == "DEV"
    assert body["country_code"] == "KW"
    for key in (
        "id",
        "name_ar",
        "name_en",
        "primary_color",
        "default_language",
        "default_currency",
    ):
        assert key in body


async def test_patch_organization_changes_settings(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    # round-trip: set then read, then revert to keep other tests honest
    before = (await api.get("/api/v1/organization", headers=auth_headers)).json()
    original_color = before["primary_color"]
    original_lang = before["default_language"]

    r = await api.patch(
        "/api/v1/organization",
        json={"primary_color": "#123456", "default_language": "en"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["primary_color"] == "#123456"
    assert r.json()["default_language"] == "en"

    # Revert
    r = await api.patch(
        "/api/v1/organization",
        json={"primary_color": original_color, "default_language": original_lang},
        headers=auth_headers,
    )
    assert r.status_code == 200


async def test_patch_rejects_bad_color(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.patch(
        "/api/v1/organization",
        json={"primary_color": "not-a-color"},
        headers=auth_headers,
    )
    assert r.status_code == 422


# ── Reporting cadence (organizations.report_cadence_days, 0033) ──────────


async def test_report_cadence_set_read_clear(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Cadence set via PATCH is read back by GET, and an explicit null
    clears it back to NULL (= platform default)."""
    before = (await api.get("/api/v1/organization", headers=auth_headers)).json()
    assert before["report_cadence_days"] is None  # seed org has no cadence

    r = await api.patch(
        "/api/v1/organization",
        json={"report_cadence_days": 30},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["report_cadence_days"] == 30

    r = await api.get("/api/v1/organization", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["report_cadence_days"] == 30

    # Explicit null — cleared back to NULL (means default)
    r = await api.patch(
        "/api/v1/organization",
        json={"report_cadence_days": None},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["report_cadence_days"] is None


async def test_report_cadence_partial_patch_leaves_other_fields(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A PATCH carrying ONLY report_cadence_days must not disturb any other
    org field (exclude_unset semantics)."""
    before = (await api.get("/api/v1/organization", headers=auth_headers)).json()

    r = await api.patch(
        "/api/v1/organization",
        json={"report_cadence_days": 60},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["report_cadence_days"] == 60
    for key, value in before.items():
        if key in ("report_cadence_days", "updated_at"):
            continue
        assert after[key] == value, f"{key} changed by a cadence-only PATCH"

    # Revert to keep other tests honest
    r = await api.patch(
        "/api/v1/organization",
        json={"report_cadence_days": None},
        headers=auth_headers,
    )
    assert r.status_code == 200


async def test_report_cadence_out_of_range_rejected_by_pydantic(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The boundary rejects values outside 1..366 with a 422 (Field ge/le)
    — requests never reach the DB CHECK."""
    for bad in (0, -1, 367):
        r = await api.patch(
            "/api/v1/organization",
            json={"report_cadence_days": bad},
            headers=auth_headers,
        )
        assert r.status_code == 422, f"{bad}: {r.text}"

    # Both edges of the valid range are accepted
    for ok in (1, 366):
        r = await api.patch(
            "/api/v1/organization",
            json={"report_cadence_days": ok},
            headers=auth_headers,
        )
        assert r.status_code == 200, f"{ok}: {r.text}"
        assert r.json()["report_cadence_days"] == ok

    # Revert
    r = await api.patch(
        "/api/v1/organization",
        json={"report_cadence_days": None},
        headers=auth_headers,
    )
    assert r.status_code == 200


async def test_report_cadence_out_of_range_rejected_by_db_check(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Writing an out-of-range cadence straight to the DB (bypassing
    Pydantic) trips the organizations_report_cadence_days_check constraint."""
    org_id = (await api.get("/api/v1/organization", headers=auth_headers)).json()["id"]

    for bad in (0, 367):
        with pytest.raises(IntegrityError, match="organizations_report_cadence_days_check"):
            async with make_session() as db:
                await db.execute(
                    text("UPDATE organizations SET report_cadence_days = :v WHERE id = :id"),
                    {"v": bad, "id": org_id},
                )
                await db.commit()
