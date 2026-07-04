"""R6 — independence stage field + the gated donor ``independence`` element.

Exercised here:

* ``orphans.independence_stage`` round-trip on the staff create and PATCH
  paths, with the ordered coded vocabulary enforced (422 otherwise);
* the donor profile (``GET /me/sponsorships/{orphan_id}/profile``) carries the
  ``independence`` block ONLY when the element is visible AND a stage is set —
  and the block is EXACTLY ``stage`` (the "next step" and the empowerment
  charter are frontend-derived, never data);
* the ``independence`` element registers in the staff GET/PUT visibility
  registry;
* ``PublicOrphanDetail`` (the pre-sponsorship public card) still exposes NO
  independence data whatsoever;
* migration 0030 is reversible (upgrade ↔ downgrade) against the test DB.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from httpx import AsyncClient
from sqlalchemy import text

from app.core.config import settings
from app.core.database import make_session

_BACKEND_DIR = Path(__file__).resolve().parents[2]

# The donor independence block is EXACTLY this single-field slice — nothing
# else may ever be added without a deliberate privacy review.
_INDEPENDENCE_BLOCK_KEYS = {"stage"}

# The ordered coded vocabulary — mirrors the IndependenceStage Literal.
_STAGES = (
    "childhood",
    "skill_building",
    "vocational_training",
    "empowerment",
    "independence",
)


# ── Fixtures / helpers ─────────────────────────────────────────────────────


async def _partner_id(api: AsyncClient, headers: dict[str, str]) -> str:
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    return str(row["items"][0]["id"])


async def _make_orphan(
    api: AsyncClient, admin_headers: dict[str, str], partner_id: str, **extra: Any
) -> dict[str, Any]:
    suffix = uuid.uuid4().hex[:6]
    body = {
        "first_name": f"r6-{suffix}",
        "family_name": "Independence",
        "date_of_birth": "2012-03-01",
        "gender": "F",
        "nationality": "KW",
        "father_name": f"father-{suffix}",
        "partner_organization_id": partner_id,
        **extra,
    }
    r = await api.post("/api/v1/orphans", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return dict(r.json())


async def _signup_donor(
    api: AsyncClient, admin_headers: dict[str, str]
) -> tuple[str, dict[str, str]]:
    """Create an org donor + a linked, logged-in donor user; return
    (donor_id, donor_auth_headers)."""
    suffix = uuid.uuid4().hex[:8]
    email = f"r6-{suffix}@example.com"
    password = "longenoughpw1"

    donor_id = str(
        (
            await api.post(
                "/api/v1/donors",
                json={"full_name": f"Donor {suffix}", "email": email},
                headers=admin_headers,
            )
        ).json()["id"]
    )
    r = await api.post(
        "/api/v1/users/invite",
        json={"email": email, "first_name": "Test", "last_name": "Donor", "role": "donor"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    invite_token = r.json()["invite_token"]
    user_id = str(r.json()["user"]["id"])
    await api.post(
        "/api/v1/users/accept-invite", json={"token": invite_token, "password": password}
    )

    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    async with make_session() as db:
        await db.execute(
            text("UPDATE donors SET user_id = :uid WHERE id = :did"),
            {"uid": user_id, "did": donor_id},
        )
        await db.commit()
    return donor_id, headers


async def _activate_sponsorship(
    api: AsyncClient, admin_headers: dict[str, str], donor_id: str, orphan_id: str
) -> None:
    r = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor_id,
            "orphan_id": orphan_id,
            "monthly_amount": "10.00",
            "currency": "KWD",
            "start_date": "2026-01-01",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    await api.post(f"/api/v1/sponsorships/{r.json()['id']}/activate", headers=admin_headers)


async def _sponsored_profile(
    api: AsyncClient, donor_headers: dict[str, str], orphan_id: str
) -> dict[str, Any]:
    r = await api.get(f"/api/v1/me/sponsorships/{orphan_id}/profile", headers=donor_headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


# ── Staff round-trips ──────────────────────────────────────────────────────


async def test_independence_stage_round_trip_on_create(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    body = await _make_orphan(
        api,
        auth_headers,
        partner_id,
        independence_stage="skill_building",
    )
    assert body["independence_stage"] == "skill_building"

    # Re-read independently to confirm the value was persisted, not echoed.
    got = await api.get(f"/api/v1/orphans/{body['id']}", headers=auth_headers)
    assert got.status_code == 200, got.text
    assert got.json()["independence_stage"] == "skill_building"


async def test_independence_stage_defaults_null(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    body = await _make_orphan(api, auth_headers, partner_id)
    assert body["independence_stage"] is None


async def test_independence_stage_round_trip_on_patch(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id, independence_stage="childhood")

    # Every value of the ordered vocabulary is accepted on PATCH.
    for stage in _STAGES:
        r = await api.patch(
            f"/api/v1/orphans/{orphan['id']}",
            json={"independence_stage": stage},
            headers=auth_headers,
        )
        assert r.status_code == 200, (stage, r.text)
        assert r.json()["independence_stage"] == stage

    # An explicit null clears it.
    r = await api.patch(
        f"/api/v1/orphans/{orphan['id']}",
        json={"independence_stage": None},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["independence_stage"] is None


async def test_independence_stage_vocabulary_enforced(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """independence_stage is coded by the ordered vocabulary — anything else is
    a 422 on both the create and the update paths."""
    partner_id = await _partner_id(api, auth_headers)
    suffix = uuid.uuid4().hex[:6]
    for bad in ("adulthood", "graduated", "مستقلة", ""):
        r = await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"ind-{suffix}",
                "family_name": "Bounds",
                "date_of_birth": "2012-03-01",
                "gender": "M",
                "father_name": f"father-{suffix}",
                "partner_organization_id": partner_id,
                "independence_stage": bad,
            },
            headers=auth_headers,
        )
        assert r.status_code == 422, (bad, r.text)

    orphan = await _make_orphan(api, auth_headers, partner_id)
    for bad in ("adulthood", "graduated", "مستقلة", ""):
        r = await api.patch(
            f"/api/v1/orphans/{orphan['id']}",
            json={"independence_stage": bad},
            headers=auth_headers,
        )
        assert r.status_code == 422, (bad, r.text)


# ── Staff visibility registry ──────────────────────────────────────────────


async def test_independence_element_in_staff_registry(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The new element appears in the staff GET registry (visible by default)
    and is accepted by the PUT."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)

    r = await api.get(f"/api/v1/orphans/{orphan['id']}/profile-visibility", headers=auth_headers)
    assert r.status_code == 200, r.text
    by_key = {e["key"]: e["visible"] for e in r.json()["elements"]}
    assert by_key["independence"] is True

    r = await api.put(
        f"/api/v1/orphans/{orphan['id']}/profile-visibility",
        json={"visibility": {"independence": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    by_key = {e["key"]: e["visible"] for e in r.json()["elements"]}
    assert by_key["independence"] is False


# ── Donor independence block — gating + minimal slice ──────────────────────


async def test_donor_independence_block_visible_with_stage(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Visible (the default) + stage set ⇒ the block carries EXACTLY the
    single-field slice."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(
        api, auth_headers, partner_id, independence_stage="vocational_training"
    )
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["independence"] is not None
    assert set(body["independence"].keys()) == _INDEPENDENCE_BLOCK_KEYS
    assert body["independence"]["stage"] == "vocational_training"


async def test_donor_independence_block_omitted_when_hidden(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Hiding the element strips the whole block server-side even though the
    underlying stage exists."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id, independence_stage="empowerment")
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    r = await api.put(
        f"/api/v1/orphans/{orphan['id']}/profile-visibility",
        json={"visibility": {"independence": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["independence"] is None
    # No stage value escapes anywhere else in the payload either.
    dumped = json.dumps(body)
    assert "empowerment" not in dumped
    assert "independence_stage" not in dumped


async def test_donor_independence_block_omitted_without_stage(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Visible but with no stored stage ⇒ omitted (no empty shell block) — and
    it appears once the staff PATCH sets a stage."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["independence"] is None

    r = await api.patch(
        f"/api/v1/orphans/{orphan['id']}",
        json={"independence_stage": "childhood"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["independence"] == {"stage": "childhood"}


# ── Public (pre-sponsorship) card stays independence-free ──────────────────


async def test_public_detail_exposes_no_independence(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """PublicOrphanDetail is untouched: no independence field reaches the
    public browse/detail surfaces."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id, independence_stage="skill_building")
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status='available' WHERE id=:id"),
            {"id": orphan["id"]},
        )
        await db.commit()

    r = await api.get(f"/api/v1/public/orphans/{orphan['code']}")
    assert r.status_code == 200, r.text
    dumped = json.dumps(r.json())
    for field in ("independence", "independence_stage", "skill_building"):
        assert field not in dumped, f"'{field}' leaked onto the public card"

    r = await api.get("/api/v1/public/orphans?limit=50")
    assert r.status_code == 200
    item = next(it for it in r.json()["items"] if it["code"] == orphan["code"])
    assert "independence" not in json.dumps(item)


# ── Migration smoke ────────────────────────────────────────────────────────


async def _column_exists(table: str, column: str) -> bool:
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = :t AND column_name = :c"
                ),
                {"t": table, "c": column},
            )
        ).first()
    return row is not None


async def test_migration_0030_reversible(
    api: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """`alembic downgrade 0029` drops the column; `upgrade 0030` brings it
    back. Always restored to head in `finally`."""
    test_db_url = os.getenv("RUFAQAA_TEST_DATABASE_URL")
    if not test_db_url:
        pytest.skip("RUFAQAA_TEST_DATABASE_URL not set")

    monkeypatch.setattr(settings, "DATABASE_URL", test_db_url)
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))

    try:
        command.downgrade(cfg, "0029")
        assert not await _column_exists("orphans", "independence_stage")
        command.upgrade(cfg, "0030")
        assert await _column_exists("orphans", "independence_stage")
    finally:
        command.upgrade(cfg, "head")

    _ = api, auth_headers
