"""Father's memory (ذكرى الأب) — double-gated donor-profile element (PR-11).

A dignified remembrance of the deceased father, exposing ONLY his name and the
YEAR of death. Disclosure is DOUBLE-GATED: it reaches the donor only when BOTH
guardian consent (PATCH /orphans/{id}/father-memory-consent) AND the supervisor
visibility toggle (the ``father_memory`` element on profile-visibility) are on.
Default is hidden until explicitly consented.

Exercised here:

* consent=true + visible=true + father_name set → block present; ``death_year``
  is the YEAR only;
* consent=false (visible=true) → block omitted;
* visible=false (consent=true) → block omitted;
* ``father_death_date`` NULL (name set, both gates on) → block present,
  ``death_year`` null;
* the response NEVER carries ``father_death_certificate`` or a full date;
* a different-org staff member cannot set consent on this org's orphan (the
  explicit org filter holds — superuser RLS bypass notwithstanding);
* a donor who does not sponsor the child 404s on the profile.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip.
"""

from __future__ import annotations

import uuid
from typing import Any
from uuid import uuid4

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User

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
    email = f"fm-{suffix}@example.com"
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
    api: AsyncClient,
    admin_headers: dict[str, str],
    partner_id: str,
    *,
    father_name: str = "أحمد",
    father_death_date: str | None = "2019-07-14",
) -> str:
    suffix = uuid.uuid4().hex[:6]
    body: dict[str, Any] = {
        "first_name": f"fm-{suffix}",
        "family_name": "Secret",
        "date_of_birth": "2014-03-01",
        "gender": "F",
        "nationality": "KW",
        "father_name": father_name,
        "partner_organization_id": partner_id,
    }
    if father_death_date is not None:
        body["father_death_date"] = father_death_date
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


async def _sponsored_child(
    api: AsyncClient,
    admin_headers: dict[str, str],
    *,
    father_name: str = "أحمد",
    father_death_date: str | None = "2019-07-14",
) -> tuple[str, str, dict[str, str]]:
    """A donor sponsoring a freshly created child. Returns
    (orphan_id, donor_id, donor_headers)."""
    partner_id = await _partner_id(api, admin_headers)
    donor_id, donor_headers = await _signup_donor(api, admin_headers)
    orphan_id = await _make_orphan(
        api,
        admin_headers,
        partner_id,
        father_name=father_name,
        father_death_date=father_death_date,
    )
    await _activate_sponsorship(api, admin_headers, donor_id, orphan_id)
    return orphan_id, donor_id, donor_headers


async def _set_consent(
    api: AsyncClient, headers: dict[str, str], orphan_id: str, consent: bool
) -> None:
    r = await api.patch(
        f"/api/v1/orphans/{orphan_id}/father-memory-consent",
        json={"consent": consent},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["consent"] is consent


async def _set_visibility(
    api: AsyncClient, headers: dict[str, str], orphan_id: str, visible: bool
) -> None:
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/profile-visibility",
        json={"visibility": {"father_memory": visible}},
        headers=headers,
    )
    assert r.status_code == 200, r.text


async def _profile(api: AsyncClient, headers: dict[str, str], orphan_id: str) -> dict[str, Any]:
    r = await api.get(f"/api/v1/me/sponsorships/{orphan_id}/profile", headers=headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


async def _set_death_certificate(orphan_id: str, value: str) -> None:
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET father_death_certificate = :v WHERE id = :id"),
            {"v": value, "id": orphan_id},
        )
        await db.commit()


async def _other_org_admin(api: AsyncClient) -> dict[str, str]:
    """Create a separate org + an org_admin in it; return its auth headers."""
    suffix = uuid4().hex[:6]
    email = f"otherorg-fm-{suffix}@example.com"
    password = "otherorgpw123456"
    async with make_session() as db:
        org = Organization(
            code=f"FM-{suffix}",
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
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


# ── Double gate: both on ⇒ present, year only ──────────────────────────────


async def test_both_gates_on_block_present_year_only(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, _donor_id, donor_headers = await _sponsored_child(
        api, auth_headers, father_name="أحمد", father_death_date="2019-07-14"
    )
    await _set_consent(api, auth_headers, orphan_id, True)
    await _set_visibility(api, auth_headers, orphan_id, True)

    body = await _profile(api, donor_headers, orphan_id)
    assert body["father_memory"] == {"father_name": "أحمد", "death_year": 2019}
    # YEAR only — no month/day anywhere in the block.
    assert body["father_memory"]["death_year"] == 2019
    assert "2019-07-14" not in str(body)


# ── Each gate independently off ⇒ omitted ──────────────────────────────────


async def test_consent_off_block_omitted(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Default (no consent recorded) + visible ⇒ omitted; the visibility gate
    alone is not enough."""
    orphan_id, _donor_id, donor_headers = await _sponsored_child(api, auth_headers)
    await _set_visibility(api, auth_headers, orphan_id, True)
    # Consent is left at its default (false).

    body = await _profile(api, donor_headers, orphan_id)
    assert body["father_memory"] is None


async def test_consent_explicitly_revoked_block_omitted(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Granting then revoking consent (visible the whole time) re-hides it."""
    orphan_id, _donor_id, donor_headers = await _sponsored_child(api, auth_headers)
    await _set_visibility(api, auth_headers, orphan_id, True)
    await _set_consent(api, auth_headers, orphan_id, True)
    assert (await _profile(api, donor_headers, orphan_id))["father_memory"] is not None

    await _set_consent(api, auth_headers, orphan_id, False)
    assert (await _profile(api, donor_headers, orphan_id))["father_memory"] is None


async def test_visibility_off_block_omitted(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Consent on but the supervisor hid the element ⇒ omitted; consent alone is
    not enough."""
    orphan_id, _donor_id, donor_headers = await _sponsored_child(api, auth_headers)
    await _set_consent(api, auth_headers, orphan_id, True)
    await _set_visibility(api, auth_headers, orphan_id, False)

    body = await _profile(api, donor_headers, orphan_id)
    assert body["father_memory"] is None


# ── NULL death date ⇒ present, death_year null ─────────────────────────────


async def test_null_death_date_present_with_null_year(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, _donor_id, donor_headers = await _sponsored_child(
        api, auth_headers, father_name="محمود", father_death_date=None
    )
    await _set_consent(api, auth_headers, orphan_id, True)
    # father_memory is visible by default (no key in the map ⇒ visible).

    body = await _profile(api, donor_headers, orphan_id)
    assert body["father_memory"] == {"father_name": "محمود", "death_year": None}


# ── Certificate / full date never leak ─────────────────────────────────────


async def test_certificate_and_full_date_never_leak(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, _donor_id, donor_headers = await _sponsored_child(
        api, auth_headers, father_name="سالم", father_death_date="2018-02-09"
    )
    await _set_death_certificate(orphan_id, "CERT-SECRET-123")
    await _set_consent(api, auth_headers, orphan_id, True)
    await _set_visibility(api, auth_headers, orphan_id, True)

    body = await _profile(api, donor_headers, orphan_id)
    assert body["father_memory"]["death_year"] == 2018
    payload = str(body)
    assert "father_death_certificate" not in payload
    assert "CERT-SECRET-123" not in payload
    # The full date never leaves the server — only the year.
    assert "2018-02-09" not in payload
    assert "02-09" not in payload
    # profile_visibility is consumed server-side and must never reach the donor.
    assert "profile_visibility" not in body


# ── Cross-org / scope ──────────────────────────────────────────────────────


async def test_cross_org_staff_cannot_set_consent(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A staff member from another organization cannot set consent on this org's
    orphan — 404, never a leak (the explicit org filter holds)."""
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    other_headers = await _other_org_admin(api)

    r = await api.patch(
        f"/api/v1/orphans/{orphan_id}/father-memory-consent",
        json={"consent": True},
        headers=other_headers,
    )
    assert r.status_code == 404
    r = await api.get(f"/api/v1/orphans/{orphan_id}/father-memory-consent", headers=other_headers)
    assert r.status_code == 404


async def test_non_sponsoring_donor_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A donor who does not sponsor the child 404s on the profile, so the block
    is unreachable to them even with both gates on."""
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    await _set_consent(api, auth_headers, orphan_id, True)
    await _set_visibility(api, auth_headers, orphan_id, True)

    _other_donor_id, other_donor_headers = await _signup_donor(api, auth_headers)
    r = await api.get(f"/api/v1/me/sponsorships/{orphan_id}/profile", headers=other_donor_headers)
    assert r.status_code == 404


async def test_donor_rejected_on_consent_endpoints(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    _donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)

    r = await api.get(f"/api/v1/orphans/{orphan_id}/father-memory-consent", headers=donor_headers)
    assert r.status_code == 403
    r = await api.patch(
        f"/api/v1/orphans/{orphan_id}/father-memory-consent",
        json={"consent": True},
        headers=donor_headers,
    )
    assert r.status_code == 403
