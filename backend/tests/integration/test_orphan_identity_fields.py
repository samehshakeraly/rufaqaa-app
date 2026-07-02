"""R1 — small identity fields + derived orphan_status.

Exercised here:

* ``orphans.languages`` + ``orphans.current_juz`` round-trip on the staff
  create and PATCH paths, with the 1–30 bound on ``current_juz`` enforced;
* ``guardians.occupation`` round-trips on the guardian create + list reads;
* the donor profile (``GET /me/sponsorships/{orphan_id}/profile``) carries
  ``languages`` + the DERIVED ``orphan_status`` in the always-present identity
  block ("both" iff the mother is deceased — the father is always deceased in
  this domain; nothing is stored);
* ``current_juz`` surfaces on the ``her_world`` block when the element is
  visible and is omitted (with the whole block) when hidden;
* ``occupation`` is ABSENT from every donor-facing response;
* migration 0027 is reversible (upgrade ↔ downgrade) against the test DB.

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
from app.schemas.orphan import derive_orphan_status

_BACKEND_DIR = Path(__file__).resolve().parents[2]


# ── Fixtures / helpers ─────────────────────────────────────────────────────


async def _partner_id(api: AsyncClient, headers: dict[str, str]) -> str:
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    return str(row["items"][0]["id"])


async def _make_orphan(
    api: AsyncClient, admin_headers: dict[str, str], partner_id: str, **extra: Any
) -> dict[str, Any]:
    suffix = uuid.uuid4().hex[:6]
    body = {
        "first_name": f"r1-{suffix}",
        "family_name": "Identity",
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
    email = f"r1-{suffix}@example.com"
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


# ── derive_orphan_status (pure helper) ─────────────────────────────────────


def test_derive_orphan_status() -> None:
    """Only a deceased mother makes a double orphan; alive/unknown (and any
    legacy value) fall back to the paternal orphan — the father is always
    deceased in this domain."""
    assert derive_orphan_status("deceased") == "both"
    assert derive_orphan_status("alive") == "father"
    assert derive_orphan_status("unknown") == "father"
    assert derive_orphan_status("") == "father"


# ── Staff round-trips ──────────────────────────────────────────────────────


async def test_languages_and_current_juz_round_trip_on_create(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    body = await _make_orphan(
        api,
        auth_headers,
        partner_id,
        languages=["ar", "en"],
        current_juz=7,
    )
    assert body["languages"] == ["ar", "en"]
    assert body["current_juz"] == 7

    # Re-read independently to confirm the values were persisted, not echoed.
    got = await api.get(f"/api/v1/orphans/{body['id']}", headers=auth_headers)
    assert got.status_code == 200, got.text
    read = got.json()
    assert read["languages"] == ["ar", "en"]
    assert read["current_juz"] == 7


async def test_languages_default_empty_and_current_juz_null(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    body = await _make_orphan(api, auth_headers, partner_id)
    assert body["languages"] == []
    assert body["current_juz"] is None


async def test_languages_and_current_juz_round_trip_on_patch(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id, languages=["ar"], current_juz=3)

    r = await api.patch(
        f"/api/v1/orphans/{orphan['id']}",
        json={"languages": ["ar", "fr"], "current_juz": 12},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["languages"] == ["ar", "fr"]
    assert r.json()["current_juz"] == 12

    # An explicit null clears current_juz; languages can be emptied.
    r = await api.patch(
        f"/api/v1/orphans/{orphan['id']}",
        json={"languages": [], "current_juz": None},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["languages"] == []
    assert r.json()["current_juz"] is None


async def test_current_juz_bounds_enforced(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """current_juz is a juz' NUMBER (1–30) — 0 and 31 are rejected with a 422
    on both the create and the update paths."""
    partner_id = await _partner_id(api, auth_headers)
    suffix = uuid.uuid4().hex[:6]
    for bad in (0, 31):
        r = await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"bound-{suffix}-{bad}",
                "family_name": "Bounds",
                "date_of_birth": "2014-03-01",
                "gender": "M",
                "father_name": f"father-{suffix}",
                "partner_organization_id": partner_id,
                "current_juz": bad,
            },
            headers=auth_headers,
        )
        assert r.status_code == 422, (bad, r.text)

    orphan = await _make_orphan(api, auth_headers, partner_id)
    for bad in (0, 31):
        r = await api.patch(
            f"/api/v1/orphans/{orphan['id']}", json={"current_juz": bad}, headers=auth_headers
        )
        assert r.status_code == 422, (bad, r.text)


async def test_guardian_occupation_round_trip(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/families",
        json={"family_name": f"عائلة-{suffix}", "country_code": "KW"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    fid = r.json()["id"]

    r = await api.post(
        f"/api/v1/families/{fid}/guardians",
        json={"full_name": "أم اليتيم", "relation": "mother", "occupation": "خياطة"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["occupation"] == "خياطة"

    # The list read carries it back too (persisted, not echoed).
    r = await api.get(f"/api/v1/families/{fid}/guardians", headers=auth_headers)
    assert r.status_code == 200
    listed = next(g for g in r.json()["items"] if g["id"] == created["id"])
    assert listed["occupation"] == "خياطة"

    # Omitted ⇒ null (optional field, no default fabricated).
    r = await api.post(
        f"/api/v1/families/{fid}/guardians",
        json={"full_name": "بدون مهنة", "relation": "aunt"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["occupation"] is None


# ── Donor-facing identity block ────────────────────────────────────────────


async def test_donor_identity_block_carries_languages_and_orphan_status(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The always-present identity block of the donor profile carries the
    child's languages and the derived orphan_status — "both" iff the mother
    is deceased."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)

    both = await _make_orphan(
        api,
        auth_headers,
        partner_id,
        languages=["ar", "en"],
        mother_status="deceased",
    )
    await _activate_sponsorship(api, auth_headers, donor_id, both["id"])
    body = await _sponsored_profile(api, donor_headers, both["id"])
    assert body["languages"] == ["ar", "en"]
    assert body["orphan_status"] == "both"

    father_only = await _make_orphan(api, auth_headers, partner_id, mother_status="alive")
    await _activate_sponsorship(api, auth_headers, donor_id, father_only["id"])
    body = await _sponsored_profile(api, donor_headers, father_only["id"])
    assert body["languages"] == []
    assert body["orphan_status"] == "father"
    # The raw mother_status itself never reaches the donor — only the derived code.
    assert "mother_status" not in body


async def test_public_detail_orphan_status_father_when_mother_not_deceased(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The anonymous public detail carries the same derived pair (the shape
    itself is pinned exactly in test_public_endpoints)."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(
        api, auth_headers, partner_id, languages=["ar"], mother_status="unknown"
    )
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status='available' WHERE id=:id"),
            {"id": orphan["id"]},
        )
        await db.commit()

    r = await api.get(f"/api/v1/public/orphans/{orphan['code']}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["languages"] == ["ar"]
    assert body["orphan_status"] == "father"


# ── her_world gating ───────────────────────────────────────────────────────


async def test_current_juz_in_her_world_when_visible_omitted_when_hidden(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(
        api,
        auth_headers,
        partner_id,
        education_stage="primary",
        quran_juz_memorized=5,
        current_juz=6,
        tags=["sports"],
    )
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    # Visible (the default): current_juz rides the her_world block.
    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["her_world"] is not None
    assert body["her_world"]["current_juz"] == 6
    assert body["her_world"]["quran_juz_memorized"] == 5

    # Hidden: the whole block is omitted — current_juz never leaves the server.
    r = await api.put(
        f"/api/v1/orphans/{orphan['id']}/profile-visibility",
        json={"visibility": {"her_world": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["her_world"] is None
    # ...while the identity additions stay (identity can never be hidden).
    assert body["languages"] == []
    assert body["orphan_status"] == "father"


# ── occupation never reaches donors ────────────────────────────────────────


async def test_occupation_absent_from_every_donor_facing_response(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """occupation is staff-facing only in this batch: it must not appear in
    the public browse/detail payloads nor anywhere in the composed donor
    profile — even when the child's family has a guardian with one set."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)

    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/families",
        json={"family_name": f"عائلة-{suffix}", "country_code": "KW"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    fid = r.json()["id"]
    r = await api.post(
        f"/api/v1/families/{fid}/guardians",
        json={"full_name": "ولية الأمر", "relation": "mother", "occupation": "معلّمة"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text

    orphan = await _make_orphan(api, auth_headers, partner_id, family_id=fid)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status='available' WHERE id=:id"),
            {"id": orphan["id"]},
        )
        await db.commit()

    profile = await _sponsored_profile(api, donor_headers, orphan["id"])
    # Deep check — no nested block may carry it either.
    assert "occupation" not in json.dumps(profile)

    r = await api.get(f"/api/v1/public/orphans/{orphan['code']}")
    assert r.status_code == 200
    assert "occupation" not in r.json()

    r = await api.get("/api/v1/public/orphans?limit=50")
    assert r.status_code == 200
    item = next(it for it in r.json()["items"] if it["code"] == orphan["code"])
    assert "occupation" not in item


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


async def test_migration_0027_reversible(
    api: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """`alembic downgrade 0026` drops the three columns; `upgrade 0027` brings
    them back. Always restored to head in `finally`."""
    test_db_url = os.getenv("RUFAQAA_TEST_DATABASE_URL")
    if not test_db_url:
        pytest.skip("RUFAQAA_TEST_DATABASE_URL not set")

    monkeypatch.setattr(settings, "DATABASE_URL", test_db_url)
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))

    try:
        command.downgrade(cfg, "0026")
        assert not await _column_exists("orphans", "languages")
        assert not await _column_exists("orphans", "current_juz")
        assert not await _column_exists("guardians", "occupation")
        command.upgrade(cfg, "0027")
        assert await _column_exists("orphans", "languages")
        assert await _column_exists("orphans", "current_juz")
        assert await _column_exists("guardians", "occupation")
    finally:
        command.upgrade(cfg, "head")

    _ = api, auth_headers
