"""R5 — per-orphan skills/talents: staff CRUD + gated donor ``skills`` block.

A NEW ``orphan_skills`` table (migration 0029) with staff CRUD and a minimal
donor slice. Exercised here:

* staff CRUD round-trip — create / list / patch / delete, including the
  staff-only free-text ``note``;
* every skills query is EXPLICITLY org-scoped (the app's superuser connection
  bypasses RLS): a cross-org orphan id 404s on create (a skill can never be
  attached to another org's child), and PATCH/DELETE on another org's skill
  404s without revealing it exists — even a corrupted foreign-org skill row
  pointing at OUR orphan never surfaces on the staff list or the donor block;
* the donor profile (``GET /me/sponsorships/{orphan_id}/profile``) carries the
  ``skills`` block ONLY when the element is visible AND at least one skill
  exists — and each card is EXACTLY ``name`` / ``category`` / ``level``;
* the staff-only ``note`` (and every skill id / timestamp) NEVER appears
  anywhere in the donor payload;
* the element registers in the staff GET/PUT visibility registry;
* ``PublicOrphanDetail`` (the pre-sponsorship public card) stays skills-free;
* migration 0029 is fully reversible (downgrade drops the table, upgrade
  recreates it).

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from httpx import AsyncClient
from sqlalchemy import text

from app.core.config import settings
from app.core.database import make_session
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.skill import OrphanSkill

# The donor skill card is EXACTLY this minimal slice — nothing may ever be
# added without a deliberate privacy review.
_SKILL_CARD_KEYS = {"name", "category", "level"}

# A distinctive staff-only note value, planted so a leak is caught even under
# a renamed key.
_PLANTED_NOTE = "ملاحظة-المشرفة-السرية-R5"


# ── Fixtures / helpers ─────────────────────────────────────────────────────


async def _partner_id(api: AsyncClient, headers: dict[str, str]) -> str:
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    return str(row["items"][0]["id"])


async def _make_orphan(
    api: AsyncClient, admin_headers: dict[str, str], partner_id: str, **extra: Any
) -> dict[str, Any]:
    suffix = uuid.uuid4().hex[:6]
    body = {
        "first_name": f"r5-{suffix}",
        "family_name": "عائلة-المهارات",
        "date_of_birth": "2014-03-01",
        "gender": "F",
        "nationality": "KW",
        "father_name": "أب-المهارات",
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
    email = f"r5-{suffix}@example.com"
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


async def _make_sponsorship(
    api: AsyncClient, admin_headers: dict[str, str], donor_id: str, orphan_id: str
) -> str:
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
    return str(r.json()["id"])


async def _sponsored_profile(
    api: AsyncClient, donor_headers: dict[str, str], orphan_id: str
) -> dict[str, Any]:
    r = await api.get(f"/api/v1/me/sponsorships/{orphan_id}/profile", headers=donor_headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


async def _create_skill(
    api: AsyncClient, admin_headers: dict[str, str], orphan_id: str, **body: Any
) -> dict[str, Any]:
    r = await api.post(f"/api/v1/orphans/{orphan_id}/skills", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return dict(r.json())


async def _foreign_org_fixture() -> tuple[str, str, str]:
    """Plant a FOREIGN organization with its own partner + orphan + one skill,
    written directly (no API surface crosses orgs). Returns
    (foreign_orphan_id, foreign_skill_id, foreign_org_id)."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        other_org = Organization(
            code=f"R5X-{suffix}",
            name_ar=f"منظمة-أخرى-{suffix}",
            name_en=f"Other Org {suffix}",
            org_type="standalone",
            country_code="KW",
        )
        db.add(other_org)
        await db.flush()
        foreign_partner = PartnerOrganization(
            organization_id=other_org.id,
            code=f"PRTX-{suffix}",
            name_ar=f"شريك-أجنبي-{suffix}",
            name_en=f"Foreign Partner {suffix}",
            country_code="KW",
            status="active",
        )
        db.add(foreign_partner)
        await db.flush()
        foreign_orphan = Orphan(
            organization_id=other_org.id,
            partner_organization_id=foreign_partner.id,
            code=f"ORPX-{suffix}",
            first_name="يتيمة-أجنبية",
            family_name="عائلة-أجنبية",
            date_of_birth=datetime(2013, 1, 1, tzinfo=UTC).date(),
            gender="F",
        )
        db.add(foreign_orphan)
        await db.flush()
        foreign_skill = OrphanSkill(
            organization_id=other_org.id,
            orphan_id=foreign_orphan.id,
            name="مهارة-أجنبية",
            category="arts",
            level="advanced",
        )
        db.add(foreign_skill)
        await db.commit()
        return str(foreign_orphan.id), str(foreign_skill.id), str(other_org.id)


# ── Staff CRUD round-trip ──────────────────────────────────────────────────


async def test_staff_crud_round_trip(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Create → list → patch → delete, with the staff view carrying the full
    row (including the staff-only note and the timestamps)."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)

    created = await _create_skill(
        api,
        auth_headers,
        orphan["id"],
        name="تلاوة القرآن",
        category="quran",
        level="intermediate",
        note=_PLANTED_NOTE,
    )
    assert created["orphan_id"] == orphan["id"]
    assert created["name"] == "تلاوة القرآن"
    assert created["category"] == "quran"
    assert created["level"] == "intermediate"
    assert created["note"] == _PLANTED_NOTE
    assert created["created_at"] and created["updated_at"]

    second = await _create_skill(api, auth_headers, orphan["id"], name="الرسم")
    assert second["category"] is None and second["level"] is None and second["note"] is None

    r = await api.get(f"/api/v1/orphans/{orphan['id']}/skills", headers=auth_headers)
    assert r.status_code == 200, r.text
    items = r.json()
    # Oldest first — the donor block renders the same order.
    assert [s["id"] for s in items] == [created["id"], second["id"]]

    r = await api.patch(
        f"/api/v1/skills/{second['id']}",
        json={"category": "arts", "level": "beginner", "note": "تحب الألوان المائية"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    patched = r.json()
    assert patched["name"] == "الرسم"  # untouched — PATCH applies only supplied fields
    assert patched["category"] == "arts"
    assert patched["level"] == "beginner"
    assert patched["note"] == "تحب الألوان المائية"

    r = await api.delete(f"/api/v1/skills/{second['id']}", headers=auth_headers)
    assert r.status_code == 204, r.text
    r = await api.get(f"/api/v1/orphans/{orphan['id']}/skills", headers=auth_headers)
    assert [s["id"] for s in r.json()] == [created["id"]]
    # Deleting again 404s — the row is gone.
    r = await api.delete(f"/api/v1/skills/{second['id']}", headers=auth_headers)
    assert r.status_code == 404


async def test_create_rejects_unknown_coded_values(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """category/level are coded vocabularies enforced at the Pydantic boundary
    — an unknown value (or a blank/oversized name) is a 422, never stored."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)

    for body in (
        {"name": "x", "category": "not-a-category"},
        {"name": "x", "level": "grandmaster"},
        {"name": "   "},
        {"name": "م" * 61},
    ):
        r = await api.post(
            f"/api/v1/orphans/{orphan['id']}/skills", json=body, headers=auth_headers
        )
        assert r.status_code == 422, f"{body} → {r.status_code}"


# ── Cross-org fence — the explicit organization_id filter ──────────────────


async def test_cross_org_create_rejected(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A skill can never be attached to another org's orphan: the create loads
    the orphan filtered by the CALLER's organization_id first, so a foreign
    orphan id 404s exactly like an unknown id."""
    foreign_orphan_id, _, _ = await _foreign_org_fixture()

    r = await api.post(
        f"/api/v1/orphans/{foreign_orphan_id}/skills",
        json={"name": "اختراق"},
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text
    async with make_session() as db:
        count = await db.scalar(
            text("SELECT COUNT(*) FROM orphan_skills WHERE orphan_id = :oid AND name = 'اختراق'"),
            {"oid": foreign_orphan_id},
        )
    assert count == 0


async def test_cross_org_patch_and_delete_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """PATCH/DELETE on another org's skill 404s — the explicit org predicate
    hides the row entirely (no read, no mutation, no existence leak)."""
    _, foreign_skill_id, _ = await _foreign_org_fixture()

    r = await api.patch(
        f"/api/v1/skills/{foreign_skill_id}", json={"name": "مسروقة"}, headers=auth_headers
    )
    assert r.status_code == 404, r.text
    r = await api.delete(f"/api/v1/skills/{foreign_skill_id}", headers=auth_headers)
    assert r.status_code == 404, r.text
    async with make_session() as db:
        name = await db.scalar(
            text("SELECT name FROM orphan_skills WHERE id = :id"), {"id": foreign_skill_id}
        )
    assert name == "مهارة-أجنبية"  # untouched


async def test_foreign_org_skill_on_our_orphan_never_surfaces(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Even when a FOREIGN-org skill row points at OUR orphan (data corruption /
    hostile write), neither the staff list nor the donor block ever shows it:
    both filter organization_id explicitly, because the superuser DB connection
    bypasses RLS."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _make_sponsorship(api, auth_headers, donor_id, orphan["id"])

    _, _, foreign_org_id = await _foreign_org_fixture()
    async with make_session() as db:
        db.add(
            OrphanSkill(
                organization_id=uuid.UUID(foreign_org_id),
                orphan_id=uuid.UUID(orphan["id"]),
                name="مهارة-مزروعة",
            )
        )
        await db.commit()

    r = await api.get(f"/api/v1/orphans/{orphan['id']}/skills", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    # The corrupted row is the only orphan_id match — so the block stays None.
    assert body["skills"] is None
    assert "مهارة-مزروعة" not in json.dumps(body, ensure_ascii=False)


# ── Donor block — gating + minimal slice ───────────────────────────────────


async def _sponsored_child_with_skills(
    api: AsyncClient, admin_headers: dict[str, str]
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, str]]:
    """A donor sponsoring a child with two skills (the first carries the
    planted staff-only note). Returns (child, [skill, skill], donor_headers)."""
    partner_id = await _partner_id(api, admin_headers)
    donor_id, donor_headers = await _signup_donor(api, admin_headers)
    child = await _make_orphan(api, admin_headers, partner_id)
    first = await _create_skill(
        api,
        admin_headers,
        child["id"],
        name="حفظ القرآن",
        category="quran",
        level="advanced",
        note=_PLANTED_NOTE,
    )
    second = await _create_skill(api, admin_headers, child["id"], name="الخط العربي")
    await _make_sponsorship(api, admin_headers, donor_id, child["id"])
    return child, [first, second], donor_headers


async def test_skills_block_visible_with_data(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Visible (the default) + skills on record ⇒ one card per skill, EXACTLY
    the allowlist, oldest first."""
    child, skills, donor_headers = await _sponsored_child_with_skills(api, auth_headers)

    body = await _sponsored_profile(api, donor_headers, child["id"])
    assert body["skills"] is not None
    items = body["skills"]["items"]
    assert [i["name"] for i in items] == [skills[0]["name"], skills[1]["name"]]
    for item in items:
        assert set(item.keys()) == _SKILL_CARD_KEYS
    assert items[0] == {"name": "حفظ القرآن", "category": "quran", "level": "advanced"}
    assert items[1] == {"name": "الخط العربي", "category": None, "level": None}


async def test_skills_block_omitted_when_hidden(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Hiding the element strips the whole block server-side even though the
    skills exist — and no skill value escapes anywhere else."""
    child, skills, donor_headers = await _sponsored_child_with_skills(api, auth_headers)

    r = await api.put(
        f"/api/v1/orphans/{child['id']}/profile-visibility",
        json={"visibility": {"skills": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _sponsored_profile(api, donor_headers, child["id"])
    assert body["skills"] is None
    dumped = json.dumps(body, ensure_ascii=False)
    for skill in skills:
        assert skill["name"] not in dumped


async def test_skills_block_omitted_without_skills(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Visible but no skills on record ⇒ the block is omitted (no empty shell)
    — and it reappears as soon as the first skill lands."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _make_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["skills"] is None

    await _create_skill(api, auth_headers, orphan["id"], name="السباحة", category="sports")
    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["skills"] == {"items": [{"name": "السباحة", "category": "sports", "level": None}]}


# ── Content safety — the note (and ids/timestamps) never leak ──────────────


async def test_note_ids_timestamps_never_in_donor_payload(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """With the element visible and fully populated rows, the staff-only note,
    the skill ids and the row timestamps appear NOWHERE in the donor payload —
    the card is the allowlist and nothing more."""
    child, skills, donor_headers = await _sponsored_child_with_skills(api, auth_headers)

    body = await _sponsored_profile(api, donor_headers, child["id"])
    dumped = json.dumps(body, ensure_ascii=False)
    assert _PLANTED_NOTE not in dumped, "staff-only note leaked into the donor payload"
    assert '"note"' not in json.dumps(body["skills"], ensure_ascii=False)
    for skill in skills:
        assert skill["id"] not in dumped
        assert skill["created_at"] not in dumped


# ── Staff visibility registry ──────────────────────────────────────────────


async def test_skills_in_staff_registry(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """The new element appears in the staff GET registry (visible by default)
    and is accepted by the PUT."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)

    r = await api.get(f"/api/v1/orphans/{orphan['id']}/profile-visibility", headers=auth_headers)
    assert r.status_code == 200, r.text
    by_key = {e["key"]: e["visible"] for e in r.json()["elements"]}
    assert by_key["skills"] is True

    r = await api.put(
        f"/api/v1/orphans/{orphan['id']}/profile-visibility",
        json={"visibility": {"skills": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    by_key = {e["key"]: e["visible"] for e in r.json()["elements"]}
    assert by_key["skills"] is False


# ── Public (pre-sponsorship) card stays skills-free ────────────────────────


async def test_public_card_exposes_no_skills(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """PublicOrphanCard/Detail are untouched: no skills key (or skill value)
    reaches the public browse/detail surfaces even for a child with skills."""
    child, skills, _donor_headers = await _sponsored_child_with_skills(api, auth_headers)
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status='available' WHERE id=:id"),
            {"id": child["id"]},
        )
        await db.commit()

    r = await api.get(f"/api/v1/public/orphans/{child['code']}")
    assert r.status_code == 200, r.text
    dumped = json.dumps(r.json(), ensure_ascii=False)
    assert '"skills"' not in dumped, "'skills' leaked onto the public card"
    for skill in skills:
        assert skill["name"] not in dumped

    r = await api.get("/api/v1/public/orphans?limit=50")
    assert r.status_code == 200
    item = next(it for it in r.json()["items"] if it["code"] == child["code"])
    assert '"skills"' not in json.dumps(item, ensure_ascii=False)


# ── Migration 0029 — fully reversible ──────────────────────────────────────


def _alembic_config() -> Config:
    backend_dir = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    return cfg


async def _table_exists(table: str) -> bool:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT 1 FROM information_schema.tables WHERE table_name = :t"),
                {"t": table},
            )
        ).first()
    return row is not None


async def test_migration_0029_reversible(
    api: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """upgrade → downgrade → upgrade leaves a clean schema: the table (and its
    composite org/orphan index) disappear on downgrade and return on upgrade."""
    test_db_url = os.getenv("RUFAQAA_TEST_DATABASE_URL")
    if not test_db_url:
        pytest.skip("RUFAQAA_TEST_DATABASE_URL not set")

    monkeypatch.setattr(settings, "DATABASE_URL", test_db_url)
    cfg = _alembic_config()

    assert await _table_exists("orphan_skills")
    try:
        command.downgrade(cfg, "0028")
        assert not await _table_exists("orphan_skills")

        command.upgrade(cfg, "0029")
        assert await _table_exists("orphan_skills")
        async with make_session() as db:
            row = (
                await db.execute(
                    text(
                        "SELECT 1 FROM pg_indexes WHERE tablename = 'orphan_skills' "
                        "AND indexname = 'idx_orphan_skills_org_orphan'"
                    )
                )
            ).first()
        assert row is not None
    finally:
        # Always leave the DB at head, whatever happened above.
        command.upgrade(cfg, "head")
