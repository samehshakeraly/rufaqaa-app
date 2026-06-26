"""Per-element donor-profile visibility (PR-1).

Backend governance foundation: an orphanage supervisor/manager shows or hides
any element of the donor-facing child profile, and the donor composition
endpoint enforces it server-side (a hidden element never leaves the server).

Exercised here:

* the composed donor profile (``GET /me/sponsorships/{orphan_id}/profile``)
  returns the always-present identity block plus every element block that has
  backing data when ``profile_visibility`` is the default ``{}``;
* a staff ``PUT`` setting one element ``false`` OMITS that block from the donor
  view while the others stay; identity survives even when every element is hidden;
* ``profile_visibility`` itself never appears in the donor payload;
* the staff registry GET/PUT works for same-org staff, while a donor and a
  different-org staff member are rejected, and a bad PUT body is 422;
* migration 0023 is reversible (upgrade ↔ downgrade) against the test DB.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from httpx import AsyncClient
from sqlalchemy import text

from app.core.config import settings
from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User
from app.schemas.profile_visibility import ProfileElement

_BACKEND_DIR = Path(__file__).resolve().parents[2]

_ALL_ELEMENTS = {e.value for e in ProfileElement}


# ── Fixtures / helpers ─────────────────────────────────────────────────────


async def _partner_id(api: AsyncClient, headers: dict[str, str]) -> str:
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    return str(row["items"][0]["id"])


async def _signup_donor(
    api: AsyncClient, admin_headers: dict[str, str]
) -> tuple[str, dict[str, str]]:
    """Create an org donor + a linked, logged-in donor user; return
    (donor_id, donor_auth_headers)."""
    suffix = uuid.uuid4().hex[:8]
    email = f"dpv-{suffix}@example.com"
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


async def _make_orphan(
    api: AsyncClient, admin_headers: dict[str, str], partner_id: str, **extra: Any
) -> str:
    suffix = uuid.uuid4().hex[:6]
    body = {
        "first_name": f"prof-{suffix}",
        "family_name": "Secret",
        "date_of_birth": "2014-03-01",
        "gender": "M",
        "nationality": "KW",
        "father_name": f"father-{suffix}",
        "partner_organization_id": partner_id,
        "aspiration": "doctor",
        "education_stage": "primary",
        "quran_juz_memorized": 5,
        "tags": ["sports", "reading"],
        **extra,
    }
    r = await api.post("/api/v1/orphans", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


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


async def _publish_report(
    api: AsyncClient, headers: dict[str, str], orphan_id: str, extra: dict[str, Any]
) -> None:
    """Create a report carrying ``extra`` and walk it to published_to_donor."""
    base = {
        "orphan_id": orphan_id,
        "report_type": "monthly",
        "period_start": extra.pop("period_start", "2026-02-01"),
        "period_end": extra.pop("period_end", "2026-02-28"),
        "summary": "ملخّص",
    }
    r = await api.post("/api/v1/reports", json={**base, **extra}, headers=headers)
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    for step in ("submit", "approve-partner", "approve-org", "publish"):
        rr = await api.post(f"/api/v1/reports/{rid}/{step}", headers=headers)
        assert rr.status_code == 200, (step, rr.text)


async def _seeded_child_with_history(
    api: AsyncClient, admin_headers: dict[str, str]
) -> tuple[str, str, dict[str, str]]:
    """A donor sponsoring a child who has two published reports (so every
    report-derived block has data). Returns (orphan_id, donor_id, donor_headers)."""
    partner_id = await _partner_id(api, admin_headers)
    donor_id, donor_headers = await _signup_donor(api, admin_headers)
    orphan_id = await _make_orphan(api, admin_headers, partner_id)
    await _activate_sponsorship(api, admin_headers, donor_id, orphan_id)

    await _publish_report(
        api,
        admin_headers,
        orphan_id,
        {
            "period_start": "2026-01-01",
            "period_end": "2026-01-31",
            "educational_progress": {"stage": "ابتدائي", "attendance_percent": 80},
            "quran_progress": {"juz_memorized": 3},
            "psychological_status": {"social": "good"},
        },
    )
    await _publish_report(
        api,
        admin_headers,
        orphan_id,
        {
            "period_start": "2026-03-01",
            "period_end": "2026-03-31",
            "educational_progress": {"stage": "متوسط", "attendance_percent": 95},
            "quran_progress": {"juz_memorized": 5},
            "psychological_status": {"social": "excellent"},
            "is_milestone": True,
            "milestone_label": "أتمّ حفظ جزء جديد",
            "donor_message": "نشكر لكم كفالتكم الكريمة.",
        },
    )
    return orphan_id, donor_id, donor_headers


async def _profile(api: AsyncClient, headers: dict[str, str], orphan_id: str) -> dict[str, Any]:
    r = await api.get(f"/api/v1/me/sponsorships/{orphan_id}/profile", headers=headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


# ── Default visibility: identity + all data-backed blocks ──────────────────


async def test_default_visibility_returns_all_blocks(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, _donor_id, donor_headers = await _seeded_child_with_history(api, auth_headers)
    body = await _profile(api, donor_headers, orphan_id)

    # Identity/header is always present.
    assert body["first_name"]
    assert body["is_hafiz"] is False

    # Every element block has backing data, so none is null.
    assert body["dream"] == {"aspiration": "doctor"}
    assert body["her_world"]["education_stage"] == "primary"
    assert body["her_world"]["tags"] == ["sports", "reading"]
    assert body["quran_growth"]["series"] == [
        {"period": "2026-01-31", "juz_memorized": 3},
        {"period": "2026-03-31", "juz_memorized": 5},
    ]
    assert body["multidim_growth"]["education_stage"] == {"first": "ابتدائي", "latest": "متوسط"}
    assert body["multidim_growth"]["attendance_percent"] == {"first": 80, "latest": 95}
    assert body["multidim_growth"]["social"] == {"first": "good", "latest": "excellent"}
    assert body["milestones"]["items"] == [{"label": "أتمّ حفظ جزء جديد", "period": "2026-03-31"}]
    assert len(body["recent_updates"]["items"]) == 2
    assert body["supervisor_word"]["text"] == "نشكر لكم كفالتكم الكريمة."
    assert body["since_you_began"]["juz_gained"] == 2
    assert body["since_you_began"]["reports_count"] == 2
    assert body["since_you_began"]["milestones_count"] == 1

    # The visibility map never reaches the donor.
    assert "profile_visibility" not in body


# ── Staff PUT hides one element; donor view omits it, others stay ──────────


async def test_hidden_element_omitted_from_donor_view(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, _donor_id, donor_headers = await _seeded_child_with_history(api, auth_headers)

    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/profile-visibility",
        json={"visibility": {"quran_growth": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _profile(api, donor_headers, orphan_id)
    # The hidden element collapses to null...
    assert body["quran_growth"] is None
    # ...while the others stay.
    assert body["dream"] is not None
    assert body["her_world"] is not None
    assert body["milestones"] is not None
    assert "profile_visibility" not in body


async def test_identity_present_even_when_all_elements_hidden(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, _donor_id, donor_headers = await _seeded_child_with_history(api, auth_headers)

    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/profile-visibility",
        json={"visibility": {e: False for e in _ALL_ELEMENTS}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _profile(api, donor_headers, orphan_id)
    # Every toggleable block is gone...
    for element in _ALL_ELEMENTS:
        assert body[element] is None, element
    # ...but the implicit identity/header block survives.
    assert body["first_name"]
    assert isinstance(body["age_years"], int)
    assert body["gender"] == "M"
    assert "profile_visibility" not in body


# ── Staff registry GET/PUT ─────────────────────────────────────────────────


async def test_staff_get_and_put_registry(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)

    # GET: full registry, every element visible by default, raw map empty.
    r = await api.get(f"/api/v1/orphans/{orphan_id}/profile-visibility", headers=auth_headers)
    assert r.status_code == 200, r.text
    reg = r.json()
    assert {e["key"] for e in reg["elements"]} == _ALL_ELEMENTS
    assert all(e["visible"] for e in reg["elements"])
    assert reg["stored"] == {}

    # PUT: hide one, show another explicitly.
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/profile-visibility",
        json={"visibility": {"dream": False, "milestones": True}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    reg = r.json()
    assert reg["stored"] == {"dream": False, "milestones": True}
    by_key = {e["key"]: e["visible"] for e in reg["elements"]}
    assert by_key["dream"] is False
    assert by_key["milestones"] is True
    # An untouched element stays visible (absent ⇒ visible).
    assert by_key["her_world"] is True

    # GET again reflects the persisted map.
    reg2 = (
        await api.get(f"/api/v1/orphans/{orphan_id}/profile-visibility", headers=auth_headers)
    ).json()
    assert reg2["stored"] == {"dream": False, "milestones": True}


async def test_donor_rejected_on_staff_endpoints(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    _donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)

    r = await api.get(f"/api/v1/orphans/{orphan_id}/profile-visibility", headers=donor_headers)
    assert r.status_code == 403
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/profile-visibility",
        json={"visibility": {"dream": False}},
        headers=donor_headers,
    )
    assert r.status_code == 403


async def test_different_org_staff_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A staff member from another organization cannot see (or learn the
    existence of) this org's orphan — 404, never a leak."""
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)

    # Build a separate org + an org_admin in it, then log in.
    suffix = uuid4().hex[:6]
    email = f"otherorg-{suffix}@example.com"
    password = "otherorgpw123456"
    async with make_session() as db:
        org = Organization(
            code=f"DPV-{suffix}",
            name_ar=f"منظمة-{suffix}",
            name_en=f"Org {suffix}",
            org_type="standalone",
            country_code="KW",
        )
        db.add(org)
        await db.commit()
        await db.refresh(org)
        db.add(
            User(
                organization_id=org.id,
                email=email,
                password_hash=hash_password(password),
                first_name="Other",
                last_name="Admin",
                role="org_admin",
                status="active",
            )
        )
        await db.commit()
    login = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    other_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    r = await api.get(f"/api/v1/orphans/{orphan_id}/profile-visibility", headers=other_headers)
    assert r.status_code == 404
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/profile-visibility",
        json={"visibility": {"dream": False}},
        headers=other_headers,
    )
    assert r.status_code == 404


async def test_put_unknown_key_is_422(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/profile-visibility",
        json={"visibility": {"not_a_real_element": False}},
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


async def test_put_non_bool_value_is_422(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/profile-visibility",
        json={"visibility": {"dream": "nope"}},
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


# ── Migration smoke ────────────────────────────────────────────────────────


async def _column_exists(column: str) -> bool:
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'orphans' AND column_name = :c"
                ),
                {"c": column},
            )
        ).first()
    return row is not None


async def test_migration_0023_reversible(
    api: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """`alembic downgrade 0022` drops orphans.profile_visibility; `upgrade 0023`
    brings it back. Always restored to head in `finally`."""
    test_db_url = os.getenv("RUFAQAA_TEST_DATABASE_URL")
    if not test_db_url:
        pytest.skip("RUFAQAA_TEST_DATABASE_URL not set")

    monkeypatch.setattr(settings, "DATABASE_URL", test_db_url)
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))

    try:
        command.downgrade(cfg, "0022")
        assert not await _column_exists("profile_visibility")
        command.upgrade(cfg, "0023")
        assert await _column_exists("profile_visibility")
    finally:
        command.upgrade(cfg, "head")

    _ = api, auth_headers
