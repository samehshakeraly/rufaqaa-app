"""R2 — static health fields + the first (gated) donor ``health`` element.

Exercised here:

* ``orphans.last_checkup`` + ``orphans.vaccinations_status`` round-trip on the
  staff create and PATCH paths, with the coded ``vaccinations_status``
  vocabulary enforced (422 otherwise);
* the donor profile (``GET /me/sponsorships/{orphan_id}/profile``) carries the
  ``health`` block ONLY when the element is visible AND at least one of the
  three underlying values exists — and the block is EXACTLY
  ``status_label`` / ``last_checkup`` / ``vaccinations_status``;
* the SENSITIVE staff-only fields (``chronic_conditions``,
  ``health_coverage``, ``challenges``) NEVER appear anywhere in the donor
  payload, even when set;
* the ``health`` element registers in the staff GET/PUT visibility registry;
* ``PublicOrphanDetail`` (the pre-sponsorship public card) still exposes NO
  health data whatsoever;
* migration 0028 is reversible (upgrade ↔ downgrade) against the test DB.

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

# The donor health block is EXACTLY this minimal slice — nothing else may ever
# be added without a deliberate privacy review.
_HEALTH_BLOCK_KEYS = {"status_label", "last_checkup", "vaccinations_status"}

# Staff-only health/context fields that must never reach a donor, at any depth.
_STAFF_ONLY_FIELDS = ("chronic_conditions", "health_coverage", "challenges")


# ── Fixtures / helpers ─────────────────────────────────────────────────────


async def _partner_id(api: AsyncClient, headers: dict[str, str]) -> str:
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    return str(row["items"][0]["id"])


async def _make_orphan(
    api: AsyncClient, admin_headers: dict[str, str], partner_id: str, **extra: Any
) -> dict[str, Any]:
    suffix = uuid.uuid4().hex[:6]
    body = {
        "first_name": f"r2-{suffix}",
        "family_name": "Health",
        "date_of_birth": "2014-03-01",
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
    email = f"r2-{suffix}@example.com"
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


async def test_static_health_round_trip_on_create(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    body = await _make_orphan(
        api,
        auth_headers,
        partner_id,
        last_checkup="2026-05-15",
        vaccinations_status="up_to_date",
    )
    assert body["last_checkup"] == "2026-05-15"
    assert body["vaccinations_status"] == "up_to_date"

    # Re-read independently to confirm the values were persisted, not echoed.
    got = await api.get(f"/api/v1/orphans/{body['id']}", headers=auth_headers)
    assert got.status_code == 200, got.text
    read = got.json()
    assert read["last_checkup"] == "2026-05-15"
    assert read["vaccinations_status"] == "up_to_date"


async def test_static_health_defaults_null(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    body = await _make_orphan(api, auth_headers, partner_id)
    assert body["last_checkup"] is None
    assert body["vaccinations_status"] is None


async def test_static_health_round_trip_on_patch(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(
        api, auth_headers, partner_id, last_checkup="2025-11-01", vaccinations_status="partial"
    )

    r = await api.patch(
        f"/api/v1/orphans/{orphan['id']}",
        json={"last_checkup": "2026-06-20", "vaccinations_status": "up_to_date"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["last_checkup"] == "2026-06-20"
    assert r.json()["vaccinations_status"] == "up_to_date"

    # An explicit null clears both.
    r = await api.patch(
        f"/api/v1/orphans/{orphan['id']}",
        json={"last_checkup": None, "vaccinations_status": None},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["last_checkup"] is None
    assert r.json()["vaccinations_status"] is None


async def test_vaccinations_status_vocabulary_enforced(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """vaccinations_status is coded (up_to_date/partial/unknown) — anything
    else is a 422 on both the create and the update paths."""
    partner_id = await _partner_id(api, auth_headers)
    suffix = uuid.uuid4().hex[:6]
    for bad in ("complete", "yes", ""):
        r = await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"vac-{suffix}",
                "family_name": "Bounds",
                "date_of_birth": "2014-03-01",
                "gender": "M",
                "father_name": f"father-{suffix}",
                "partner_organization_id": partner_id,
                "vaccinations_status": bad,
            },
            headers=auth_headers,
        )
        assert r.status_code == 422, (bad, r.text)

    orphan = await _make_orphan(api, auth_headers, partner_id)
    for bad in ("complete", "yes", ""):
        r = await api.patch(
            f"/api/v1/orphans/{orphan['id']}",
            json={"vaccinations_status": bad},
            headers=auth_headers,
        )
        assert r.status_code == 422, (bad, r.text)


# ── Staff visibility registry ──────────────────────────────────────────────


async def test_health_element_in_staff_registry(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The new element appears in the staff GET registry (visible by default)
    and is accepted by the PUT."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)

    r = await api.get(f"/api/v1/orphans/{orphan['id']}/profile-visibility", headers=auth_headers)
    assert r.status_code == 200, r.text
    by_key = {e["key"]: e["visible"] for e in r.json()["elements"]}
    assert by_key["health"] is True

    r = await api.put(
        f"/api/v1/orphans/{orphan['id']}/profile-visibility",
        json={"visibility": {"health": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    by_key = {e["key"]: e["visible"] for e in r.json()["elements"]}
    assert by_key["health"] is False


# ── Donor health block — gating + minimal slice ────────────────────────────


async def test_donor_health_block_visible_with_data(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Visible (the default) + data present ⇒ the block carries EXACTLY the
    three-field minimal slice."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(
        api,
        auth_headers,
        partner_id,
        health_status="good",
        last_checkup="2026-04-10",
        vaccinations_status="up_to_date",
        # Staff-only context that must NOT leak through the block.
        health_coverage="government",
        chronic_conditions="ربو خفيف",
        challenges="يحتاج دعمًا دراسيًا",
    )
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["health"] is not None
    assert set(body["health"].keys()) == _HEALTH_BLOCK_KEYS
    assert body["health"]["status_label"] == "good"
    assert body["health"]["last_checkup"] == "2026-04-10"
    assert body["health"]["vaccinations_status"] == "up_to_date"


async def test_donor_health_block_omitted_when_hidden(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Hiding the element strips the whole block server-side even though the
    underlying data exists."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(
        api,
        auth_headers,
        partner_id,
        health_status="under_treatment",
        last_checkup="2026-03-01",
        vaccinations_status="partial",
    )
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    r = await api.put(
        f"/api/v1/orphans/{orphan['id']}/profile-visibility",
        json={"visibility": {"health": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["health"] is None
    # No health value escapes anywhere else in the payload either.
    dumped = json.dumps(body)
    assert "under_treatment" not in dumped
    assert "2026-03-01" not in dumped
    assert "vaccinations" not in dumped


async def test_donor_health_block_omitted_without_data(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Visible but with none of the three underlying values ⇒ omitted (no
    empty shell block)."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["health"] is None


async def test_donor_health_block_partial_data_suffices(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Any ONE of the three values is enough to emit the block; the missing
    fields stay null inside it."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id, last_checkup="2026-01-05")
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["health"] == {
        "status_label": None,
        "last_checkup": "2026-01-05",
        "vaccinations_status": None,
    }


async def test_staff_only_health_fields_never_reach_donor(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """chronic_conditions / health_coverage / challenges are absent from the
    ENTIRE donor payload (any depth), even with the health element visible and
    every staff field populated."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(
        api,
        auth_headers,
        partner_id,
        health_status="chronic_condition",
        health_coverage="private",
        chronic_conditions="حالة مزمنة سرية",
        challenges="تحدٍّ سري",
        last_checkup="2026-02-02",
        vaccinations_status="unknown",
    )
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    dumped = json.dumps(body)
    for field in _STAFF_ONLY_FIELDS:
        assert field not in dumped, f"staff-only '{field}' leaked into the donor payload"
    assert "حالة مزمنة سرية" not in dumped
    assert "تحدٍّ سري" not in dumped
    # The coded slice itself is present — the gate hides fields, not the block.
    assert body["health"]["status_label"] == "chronic_condition"


# ── Public (pre-sponsorship) card stays health-free ────────────────────────


async def test_public_detail_exposes_no_health(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """PublicOrphanDetail is untouched: no health field — old or new — reaches
    the public browse/detail surfaces."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(
        api,
        auth_headers,
        partner_id,
        health_status="good",
        last_checkup="2026-04-10",
        vaccinations_status="up_to_date",
    )
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status='available' WHERE id=:id"),
            {"id": orphan["id"]},
        )
        await db.commit()

    r = await api.get(f"/api/v1/public/orphans/{orphan['code']}")
    assert r.status_code == 200, r.text
    dumped = json.dumps(r.json())
    for field in (
        "health",
        "health_status",
        "last_checkup",
        "vaccinations_status",
        *_STAFF_ONLY_FIELDS,
    ):
        assert field not in dumped, f"'{field}' leaked onto the public card"

    r = await api.get("/api/v1/public/orphans?limit=50")
    assert r.status_code == 200
    item = next(it for it in r.json()["items"] if it["code"] == orphan["code"])
    assert "health" not in json.dumps(item)


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


async def test_migration_0028_reversible(
    api: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """`alembic downgrade 0027` drops the two columns; `upgrade 0028` brings
    them back. Always restored to head in `finally`."""
    test_db_url = os.getenv("RUFAQAA_TEST_DATABASE_URL")
    if not test_db_url:
        pytest.skip("RUFAQAA_TEST_DATABASE_URL not set")

    monkeypatch.setattr(settings, "DATABASE_URL", test_db_url)
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))

    try:
        command.downgrade(cfg, "0027")
        assert not await _column_exists("orphans", "last_checkup")
        assert not await _column_exists("orphans", "vaccinations_status")
        command.upgrade(cfg, "0028")
        assert await _column_exists("orphans", "last_checkup")
        assert await _column_exists("orphans", "vaccinations_status")
    finally:
        command.upgrade(cfg, "head")

    _ = api, auth_headers
