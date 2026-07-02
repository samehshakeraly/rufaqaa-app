"""R3 — gated donor ``home`` + ``guardian`` blocks (بيت سارة / من يرعاها).

Donor EXPOSURE only, of data already in ``families``/``guardians`` — no new
columns. Exercised here:

* the donor profile (``GET /me/sponsorships/{orphan_id}/profile``) carries the
  ``home`` block ONLY when the element is visible AND the linked family has a
  governorate or housing_status — and the block is EXACTLY
  ``governorate`` / ``housing_status``;
* the ``guardian`` block ONLY when the element is visible AND the family has a
  guardian — EXACTLY ``relation`` / ``occupation`` — preferring the mother,
  then the grandmother, else the first guardian on record;
* NO other family/guardian field (name, phone, national_id, street,
  coordinates, income, …) appears ANYWHERE in the donor payload;
* a cross-org family/guardian is NEVER returned even when the orphan's
  ``family_id`` points at it — the explicit ``organization_id`` filter is the
  fence, because the app's superuser connection bypasses RLS;
* both elements register in the staff GET/PUT visibility registry;
* ``PublicOrphanDetail`` (the pre-sponsorship public card) stays home- and
  guardian-free.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.models.family import Family, Guardian
from app.models.organization import Organization

# The donor blocks are EXACTLY these minimal slices — nothing may ever be
# added without a deliberate privacy review.
_HOME_BLOCK_KEYS = {"governorate", "housing_status"}
_GUARDIAN_BLOCK_KEYS = {"relation", "occupation"}

# Staff-only family/guardian FIELD NAMES that must never reach a donor, at any
# depth of the payload.
_STAFF_ONLY_FIELDS = (
    "family_name",
    "deceased_father_name",
    "monthly_income",
    "income_currency",
    "city",
    "district",
    "village",
    "street",
    "house_number",
    "floor",
    "address_details",
    "coordinates",
    "latitude",
    "longitude",
    "notes",
    "full_name",
    "national_id",
    "phone",
    "whatsapp",
    "bank_account_info",
    "literacy_level",
    "preferred_communication",
)

# Distinctive VALUES planted on the family/guardian so a leak of any staff-only
# field is caught even under a renamed key.
_PLANTED_PII = (
    "عائلة-سرية-١٢٣",
    "شارع-سري-٤٥",
    "مدينة-سرية",
    "حي-سري-٩",
    "قرية-سرية",
    "بيت-٧٧",
    "طابق-٣",
    "ملاحظات-سرية",
    "أم-سرية-الاسم-الكامل",
    "+96599990001",
    "740.50",
)


# ── Fixtures / helpers ─────────────────────────────────────────────────────


async def _partner_id(api: AsyncClient, headers: dict[str, str]) -> str:
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    return str(row["items"][0]["id"])


async def _make_family(
    api: AsyncClient, admin_headers: dict[str, str], **extra: Any
) -> dict[str, Any]:
    """A family carrying BOTH the two donor-safe values AND a full set of
    staff-only PII, so every test doubles as a leak probe."""
    body = {
        "family_name": "عائلة-سرية-١٢٣",
        "deceased_father_name": "أب-سري",
        "country_code": "KW",
        "governorate": "الفروانية",
        "city": "مدينة-سرية",
        "district": "حي-سري-٩",
        "village": "قرية-سرية",
        "street": "شارع-سري-٤٥",
        "house_number": "بيت-٧٧",
        "floor": "طابق-٣",
        "address_details": "تفاصيل عنوان سرية",
        "monthly_income": "740.50",
        "income_currency": "USD",
        "housing_status": "rented",
        "notes": "ملاحظات-سرية",
        **extra,
    }
    r = await api.post("/api/v1/families", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return dict(r.json())


async def _add_guardian(
    api: AsyncClient,
    admin_headers: dict[str, str],
    family_id: str,
    relation: str,
    occupation: str | None = "معلّمة",
) -> dict[str, Any]:
    r = await api.post(
        f"/api/v1/families/{family_id}/guardians",
        json={
            "full_name": "أم-سرية-الاسم-الكامل",
            "national_id": f"29{uuid.uuid4().hex[:10]}",
            "relation": relation,
            "occupation": occupation,
            "phone": "+96599990001",
            "whatsapp": "+96599990001",
            "literacy_level": "medium",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return dict(r.json())


async def _make_orphan(
    api: AsyncClient, admin_headers: dict[str, str], partner_id: str, **extra: Any
) -> dict[str, Any]:
    suffix = uuid.uuid4().hex[:6]
    body = {
        "first_name": f"r3-{suffix}",
        "family_name": "Home",
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
    email = f"r3-{suffix}@example.com"
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


async def _sponsored_child_with_home(
    api: AsyncClient, admin_headers: dict[str, str], *, guardian_relation: str | None = "mother"
) -> tuple[dict[str, Any], dict[str, Any], dict[str, str]]:
    """A donor sponsoring a child linked to a fully populated family (and,
    unless ``guardian_relation`` is None, one guardian). Returns
    (orphan, family, donor_headers)."""
    partner_id = await _partner_id(api, admin_headers)
    donor_id, donor_headers = await _signup_donor(api, admin_headers)
    family = await _make_family(api, admin_headers)
    if guardian_relation is not None:
        await _add_guardian(api, admin_headers, family["id"], guardian_relation)
    orphan = await _make_orphan(api, admin_headers, partner_id, family_id=family["id"])
    await _activate_sponsorship(api, admin_headers, donor_id, orphan["id"])
    return orphan, family, donor_headers


# ── home — gating + minimal slice ──────────────────────────────────────────


async def test_home_block_visible_with_data(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Visible (the default) + a family with data ⇒ the block carries EXACTLY
    the two-field allowlist — never the city/street/income around it."""
    orphan, _family, donor_headers = await _sponsored_child_with_home(api, auth_headers)

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["home"] is not None
    assert set(body["home"].keys()) == _HOME_BLOCK_KEYS
    assert body["home"]["governorate"] == "الفروانية"
    assert body["home"]["housing_status"] == "rented"


async def test_home_block_omitted_when_hidden(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Hiding the element strips the whole block server-side even though the
    family data exists — and no home value escapes anywhere else."""
    orphan, _family, donor_headers = await _sponsored_child_with_home(api, auth_headers)

    r = await api.put(
        f"/api/v1/orphans/{orphan['id']}/profile-visibility",
        json={"visibility": {"home": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["home"] is None
    dumped = json.dumps(body, ensure_ascii=False)
    assert "الفروانية" not in dumped
    assert "rented" not in dumped
    # The sibling guardian element is untouched by the home toggle.
    assert body["guardian"] == {"relation": "mother", "occupation": "معلّمة"}


async def test_home_block_omitted_without_family(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Visible but no linked family ⇒ both blocks omitted (no empty shells)."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["home"] is None
    assert body["guardian"] is None


async def test_home_block_omitted_without_values(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A family whose governorate AND housing_status are both empty emits no
    home block — a street/city/income alone must never surface anything."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    family = await _make_family(api, auth_headers, governorate=None, housing_status=None)
    orphan = await _make_orphan(api, auth_headers, partner_id, family_id=family["id"])
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["home"] is None


async def test_home_block_partial_data_suffices(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Either one of the two values is enough; the missing one stays null."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    family = await _make_family(api, auth_headers, housing_status=None)
    orphan = await _make_orphan(api, auth_headers, partner_id, family_id=family["id"])
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["home"] == {"governorate": "الفروانية", "housing_status": None}


# ── guardian — gating + minimal slice + primary preference ─────────────────


async def test_guardian_block_visible_with_data(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Visible + a guardian on the family ⇒ EXACTLY relation + occupation."""
    orphan, _family, donor_headers = await _sponsored_child_with_home(api, auth_headers)

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["guardian"] is not None
    assert set(body["guardian"].keys()) == _GUARDIAN_BLOCK_KEYS
    assert body["guardian"]["relation"] == "mother"
    assert body["guardian"]["occupation"] == "معلّمة"


async def test_guardian_block_omitted_when_hidden(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan, _family, donor_headers = await _sponsored_child_with_home(api, auth_headers)

    r = await api.put(
        f"/api/v1/orphans/{orphan['id']}/profile-visibility",
        json={"visibility": {"guardian": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["guardian"] is None
    dumped = json.dumps(body, ensure_ascii=False)
    assert "معلّمة" not in dumped
    # The sibling home element is untouched by the guardian toggle.
    assert body["home"] == {"governorate": "الفروانية", "housing_status": "rented"}


async def test_guardian_block_omitted_without_guardian(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A family with no guardian emits no guardian block (home still does)."""
    orphan, _family, donor_headers = await _sponsored_child_with_home(
        api, auth_headers, guardian_relation=None
    )

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["guardian"] is None
    assert body["home"] is not None


async def test_guardian_block_null_occupation(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A caregiver without an occupation still surfaces her relation."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    family = await _make_family(api, auth_headers)
    await _add_guardian(api, auth_headers, family["id"], "grandmother", occupation=None)
    orphan = await _make_orphan(api, auth_headers, partner_id, family_id=family["id"])
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["guardian"] == {"relation": "grandmother", "occupation": None}


async def test_guardian_primary_prefers_mother_then_grandmother(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """With several guardians the block picks the mother over everyone,
    the grandmother over the rest, and otherwise the first on record."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)

    # uncle + grandmother + mother ⇒ mother wins, regardless of insert order.
    family = await _make_family(api, auth_headers)
    await _add_guardian(api, auth_headers, family["id"], "uncle", occupation="نجّار")
    await _add_guardian(api, auth_headers, family["id"], "grandmother", occupation="ربّة منزل")
    await _add_guardian(api, auth_headers, family["id"], "mother", occupation="خيّاطة")
    orphan = await _make_orphan(api, auth_headers, partner_id, family_id=family["id"])
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])
    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["guardian"] == {"relation": "mother", "occupation": "خيّاطة"}

    # uncle + grandmother (no mother) ⇒ grandmother.
    family2 = await _make_family(api, auth_headers)
    await _add_guardian(api, auth_headers, family2["id"], "uncle", occupation="نجّار")
    await _add_guardian(api, auth_headers, family2["id"], "grandmother", occupation="ربّة منزل")
    orphan2 = await _make_orphan(api, auth_headers, partner_id, family_id=family2["id"])
    await _activate_sponsorship(api, auth_headers, donor_id, orphan2["id"])
    body2 = await _sponsored_profile(api, donor_headers, orphan2["id"])
    assert body2["guardian"] == {"relation": "grandmother", "occupation": "ربّة منزل"}

    # uncle + aunt (neither preferred) ⇒ the first on record.
    family3 = await _make_family(api, auth_headers)
    await _add_guardian(api, auth_headers, family3["id"], "uncle", occupation="نجّار")
    await _add_guardian(api, auth_headers, family3["id"], "aunt", occupation="ممرّضة")
    orphan3 = await _make_orphan(api, auth_headers, partner_id, family_id=family3["id"])
    await _activate_sponsorship(api, auth_headers, donor_id, orphan3["id"])
    body3 = await _sponsored_profile(api, donor_headers, orphan3["id"])
    assert body3["guardian"] == {"relation": "uncle", "occupation": "نجّار"}


# ── Content safety — nothing else ever leaks ───────────────────────────────


async def test_no_family_or_guardian_pii_anywhere_in_payload(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """With BOTH elements visible and a fully populated family + guardian, no
    staff-only field name and no planted PII value appears ANYWHERE in the
    donor payload — the blocks are the allowlists and nothing more."""
    orphan, _family, donor_headers = await _sponsored_child_with_home(api, auth_headers)

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    dumped = json.dumps(body, ensure_ascii=False)
    for field in _STAFF_ONLY_FIELDS:
        # family_name is also a (donor-safe-suppressed) orphan column asserted
        # absent by test_sponsored_profile_donor; here it guards the family row.
        assert f'"{field}"' not in dumped, f"staff-only '{field}' leaked into the donor payload"
    for planted in _PLANTED_PII:
        assert planted not in dumped, f"planted PII value '{planted}' leaked into the donor payload"


async def test_blocks_are_exactly_the_allowlists(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Shape lock: the two blocks carry EXACTLY the allowlisted keys, and the
    family's id/code are absent from the whole payload."""
    orphan, family, donor_headers = await _sponsored_child_with_home(api, auth_headers)

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert set(body["home"].keys()) == _HOME_BLOCK_KEYS
    assert set(body["guardian"].keys()) == _GUARDIAN_BLOCK_KEYS
    dumped = json.dumps(body, ensure_ascii=False)
    assert family["id"] not in dumped
    assert family["code"] not in dumped


# ── Cross-org fence — the explicit organization_id filter ──────────────────


async def test_cross_org_family_and_guardian_never_returned(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Even if an orphan's family_id points at ANOTHER org's family (data
    corruption / hostile write), the donor sees NO home and NO guardian: the
    builders filter by the orphan's organization_id explicitly, because the
    superuser DB connection bypasses RLS."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan["id"])

    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        other_org = Organization(
            code=f"R3X-{suffix}",
            name_ar=f"منظمة-أخرى-{suffix}",
            name_en=f"Other Org {suffix}",
            org_type="standalone",
            country_code="KW",
        )
        db.add(other_org)
        await db.flush()
        foreign_family = Family(
            organization_id=other_org.id,
            code=f"FAMX-{suffix}",
            governorate="محافظة-أجنبية",
            housing_status="owned",
        )
        db.add(foreign_family)
        await db.flush()
        db.add(
            Guardian(
                organization_id=other_org.id,
                family_id=foreign_family.id,
                full_name="وليّة-أجنبية",
                relation="mother",
                occupation="مهنة-أجنبية",
            )
        )
        # Point the sponsored orphan at the FOREIGN family.
        await db.execute(
            text("UPDATE orphans SET family_id = :fid WHERE id = :oid"),
            {"fid": foreign_family.id, "oid": orphan["id"]},
        )
        await db.commit()

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["home"] is None
    assert body["guardian"] is None
    dumped = json.dumps(body, ensure_ascii=False)
    for foreign in ("محافظة-أجنبية", "owned", "وليّة-أجنبية", "مهنة-أجنبية"):
        assert foreign not in dumped


# ── Staff visibility registry ──────────────────────────────────────────────


async def test_home_and_guardian_in_staff_registry(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Both new elements appear in the staff GET registry (visible by default)
    and are accepted by the PUT."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)

    r = await api.get(f"/api/v1/orphans/{orphan['id']}/profile-visibility", headers=auth_headers)
    assert r.status_code == 200, r.text
    by_key = {e["key"]: e["visible"] for e in r.json()["elements"]}
    assert by_key["home"] is True
    assert by_key["guardian"] is True

    r = await api.put(
        f"/api/v1/orphans/{orphan['id']}/profile-visibility",
        json={"visibility": {"home": False, "guardian": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    by_key = {e["key"]: e["visible"] for e in r.json()["elements"]}
    assert by_key["home"] is False
    assert by_key["guardian"] is False


# ── Public (pre-sponsorship) card stays home- and guardian-free ────────────


async def test_public_card_exposes_no_home_or_guardian(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """PublicOrphanCard/Detail are untouched: no home, guardian, governorate,
    housing or relation data reaches the public browse/detail surfaces even
    for a child whose family carries all of it."""
    partner_id = await _partner_id(api, auth_headers)
    family = await _make_family(api, auth_headers)
    await _add_guardian(api, auth_headers, family["id"], "mother")
    orphan = await _make_orphan(api, auth_headers, partner_id, family_id=family["id"])
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status='available' WHERE id=:id"),
            {"id": orphan["id"]},
        )
        await db.commit()

    r = await api.get(f"/api/v1/public/orphans/{orphan['code']}")
    assert r.status_code == 200, r.text
    dumped = json.dumps(r.json(), ensure_ascii=False)
    for field in ("home", "guardian", "governorate", "housing_status", "relation", "occupation"):
        assert f'"{field}"' not in dumped, f"'{field}' leaked onto the public card"
    for planted in _PLANTED_PII:
        assert planted not in dumped

    r = await api.get("/api/v1/public/orphans?limit=50")
    assert r.status_code == 200
    item = next(it for it in r.json()["items"] if it["code"] == orphan["code"])
    dumped = json.dumps(item, ensure_ascii=False)
    assert '"home"' not in dumped
    assert '"guardian"' not in dumped
