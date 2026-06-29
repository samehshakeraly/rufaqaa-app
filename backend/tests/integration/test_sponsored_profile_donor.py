"""Donor-scoped orphan-profile endpoint tests (GET /me/sponsorships/{id}/profile).

This endpoint is the fix for the "sponsored child shows '—'" bug: the public
browse endpoint filters to browseable case statuses, so a child whose
case_status has moved to 'sponsored' 404s there. This donor-scoped twin
returns the SAME donor-safe profile, scoped by an actual sponsorship row.

Exercised here:

* Content: a donor gets 200 + the donor-safe profile for a child they
  sponsor (first_name / age_years / etc. present).
* Scoping: a child the donor does NOT sponsor — and an unknown id — both
  404, so existence never leaks.
* Content safety: the response never carries sensitive/internal fields
  (date_of_birth, national_id, health_status, school_name, guardian /
  family / address …).
* Access control: staff/admin with a valid donor_id → 200; donor passing
  another donor_id → 403; non-donor without donor_id → 400.
* Regression: a sponsored child (case_status='sponsored', NOT browseable)
  still returns 200 here.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session

# Fields that must NEVER appear in the donor-facing profile payload. The
# canonical safe set is PublicOrphanDetail (app.api.v1.public); anything
# outside it — especially these — is a leak.
_FORBIDDEN_FIELDS = {
    "date_of_birth",
    "national_id",
    "national_id_encrypted",
    "national_id_blind_index",
    "birth_certificate_number",
    "health_status",
    "health_coverage",
    "chronic_conditions",
    "challenges",
    "school_name",
    "academic_level",
    "priority_level",
    "mother_status",
    "father_name",
    "mother_name",
    "family_id",
    "family_name",
    "lives_with",
    "guardian",
    "address",
    "gps",
    "country_specific",
    "documents",
    "organization_id",
    "partner_organization_id",
}

# Identity/header block — always present, the EXACT donor-safe slice the
# composition reuses from PublicOrphanDetail (NOT the full public contract:
# code / case_status / short_description are intentionally not part of the
# donor profile composition).
_IDENTITY_FIELDS = {
    "first_name",
    "age_years",
    "gender",
    "country",
    "partner_organization_name",
    "aspiration",
    "education_stage",
    "quran_juz_memorized",
    "tags",
    "is_hafiz",
}

# One optional block per ProfileElement — always a top-level key (null when the
# element is hidden or has no backing data).
_BLOCK_FIELDS = {
    "dream",
    "her_world",
    "quran_growth",
    "multidim_growth",
    "milestones",
    "recent_updates",
    "supervisor_word",
    "since_you_began",
    "media",
    "in_her_words",
    "father_memory",
}


async def _seed_org_and_partner(api: AsyncClient, headers: dict[str, str]) -> tuple[str, str]:
    me = (await api.get("/api/v1/auth/me", headers=headers)).json()
    org_id = me["organization_id"]
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    partner_id = row["items"][0]["id"]
    return org_id, partner_id


async def _signup_donor(
    api: AsyncClient,
    admin_headers: dict[str, str],
) -> tuple[str, dict[str, str]]:
    """Create an org-scoped donor, invite + accept a linked user, return
    (donor_id, auth_headers)."""
    suffix = uuid.uuid4().hex[:8]
    email = f"d-{suffix}@example.com"
    password = "longenoughpw1"

    r = await api.post(
        "/api/v1/donors",
        json={"full_name": f"Test Donor {suffix}", "email": email},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    donor_id = str(r.json()["id"])

    r = await api.post(
        "/api/v1/users/invite",
        json={"email": email, "first_name": "Test", "last_name": "Donor", "role": "donor"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    invite_token = r.json()["invite_token"]
    user_id = str(r.json()["user"]["id"])

    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": invite_token, "password": password},
    )
    assert r.status_code == 200, r.text

    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    access = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {access}"}

    async with make_session() as db:
        await db.execute(
            text("UPDATE donors SET user_id = :uid WHERE id = :did"),
            {"uid": user_id, "did": donor_id},
        )
        await db.commit()

    return donor_id, headers


async def _make_orphan(api: AsyncClient, admin_headers: dict[str, str], partner_id: str) -> str:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"prof-{suffix}",
            "family_name": "Secret",
            "date_of_birth": "2015-03-01",
            "gender": "M",
            "nationality": "KW",
            "father_name": f"father-{suffix}",
            "partner_organization_id": partner_id,
            "aspiration": "doctor",
            "education_stage": "primary",
            "quran_juz_memorized": 5,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def _activate_sponsorship(
    api: AsyncClient,
    admin_headers: dict[str, str],
    donor_id: str,
    orphan_id: str,
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
    sp_id = str(r.json()["id"])
    await api.post(f"/api/v1/sponsorships/{sp_id}/activate", headers=admin_headers)
    return sp_id


async def _set_case_status(orphan_id: str, status: str) -> None:
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status = :s WHERE id = :id"),
            {"s": status, "id": orphan_id},
        )
        await db.commit()


# ── Content ───────────────────────────────────────────────────────────────────


async def test_donor_gets_profile_for_sponsored_child(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A donor sees the donor-safe profile of a child they sponsor."""
    _, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan)

    r = await api.get(f"/api/v1/me/sponsorships/{orphan}/profile", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["first_name"]
    assert isinstance(body["age_years"], int)
    assert body["gender"] == "M"
    assert body["country"] == "KW"
    assert body["aspiration"] == "doctor"
    assert body["education_stage"] == "primary"
    assert body["quran_juz_memorized"] == 5
    assert body["is_hafiz"] is False
    for field in _IDENTITY_FIELDS:
        assert field in body, f"Expected field '{field}' missing from profile payload"
    # The dream block surfaces the aspiration once composed.
    assert body["dream"] == {"aspiration": "doctor"}


# ── Scoping (no existence leak) ───────────────────────────────────────────────


async def test_unsponsored_child_404s(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A child the donor does NOT sponsor 404s — no leak of existence."""
    _, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    other_donor_id, _ = await _signup_donor(api, auth_headers)

    orphan_other = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, other_donor_id, orphan_other)

    r = await api.get(f"/api/v1/me/sponsorships/{orphan_other}/profile", headers=headers)
    assert r.status_code == 404


async def test_unknown_orphan_id_404s(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """An orphan id that does not exist 404s, identically to an unsponsored one."""
    _, headers = await _signup_donor(api, auth_headers)
    r = await api.get(f"/api/v1/me/sponsorships/{uuid.uuid4()}/profile", headers=headers)
    assert r.status_code == 404


# ── Content safety ────────────────────────────────────────────────────────────


async def test_forbidden_fields_never_in_payload(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """None of the sensitive/internal fields reach the donor."""
    _, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan)

    body = (await api.get(f"/api/v1/me/sponsorships/{orphan}/profile", headers=headers)).json()
    for field in _FORBIDDEN_FIELDS:
        assert field not in body, f"Forbidden field '{field}' leaked into donor profile"
    # profile_visibility is consumed server-side and must NEVER reach the donor.
    assert "profile_visibility" not in body
    # The exposed key set must be EXACTLY identity + one block per element —
    # nothing extra.
    assert set(body.keys()) == _IDENTITY_FIELDS | _BLOCK_FIELDS


# ── Access control ────────────────────────────────────────────────────────────


async def test_staff_without_donor_id_gets_400(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Non-donor callers must supply donor_id; omitting it → 400."""
    _, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, _ = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan)

    r = await api.get(f"/api/v1/me/sponsorships/{orphan}/profile", headers=auth_headers)
    assert r.status_code == 400


async def test_admin_with_valid_donor_id_gets_200(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Staff/admin passing a valid donor_id preview correctly."""
    _, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, _ = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan)

    r = await api.get(
        f"/api/v1/me/sponsorships/{orphan}/profile?donor_id={donor_id}",
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["first_name"]


async def test_donor_passing_other_donor_id_gets_403(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A donor may not pass a different donor_id to peek at another donor."""
    _, partner_id = await _seed_org_and_partner(api, auth_headers)
    _, headers_a = await _signup_donor(api, auth_headers)
    donor_b_id, _ = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_b_id, orphan)

    r = await api.get(
        f"/api/v1/me/sponsorships/{orphan}/profile?donor_id={donor_b_id}",
        headers=headers_a,
    )
    assert r.status_code == 403


# ── Regression: sponsored (non-browseable) child still resolves ───────────────


async def test_sponsored_case_status_still_returns_200(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The bug this fixes: a child whose case_status='sponsored' is NOT
    browseable on /public/orphans, but is still returned here because scoping
    is by sponsorship, not by browse status."""
    _, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan)
    await _set_case_status(orphan, "sponsored")

    r = await api.get(f"/api/v1/me/sponsorships/{orphan}/profile", headers=headers)
    assert r.status_code == 200, r.text
    # Scoping is by sponsorship, not browse status, so the profile still composes.
    assert r.json()["first_name"]
