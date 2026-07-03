"""R4 — gated donor ``siblings`` block (إخوتها).

Donor EXPOSURE only, of orphans already sharing the child's ``family_id`` —
no new columns. Exercised here:

* the donor profile (``GET /me/sponsorships/{orphan_id}/profile``) carries the
  ``siblings`` block ONLY when the element is visible AND at least one other
  (non-deleted) orphan shares the family — and each card is EXACTLY
  ``first_name`` / ``age_years`` / ``gender`` / ``sponsorship_status`` /
  ``code``, oldest sibling first;
* a sibling's standing reuses the platform's ACTIVE-sponsorship predicate:
  an active sponsorship ⇒ ``sponsored``, anything else (none, paused) ⇒
  ``awaiting_sponsor``;
* ``code`` is populated ONLY for an awaiting_sponsor sibling (the public
  sponsorship link); a sponsored sibling's code NEVER leaves the server;
* the child itself is excluded, soft-deleted siblings are excluded, and a
  cross-org orphan is NEVER returned even when it shares the ``family_id`` —
  the explicit ``organization_id`` filter is the fence, because the app's
  superuser connection bypasses RLS;
* NO other sibling field (family_name, father details, health, ids, …)
  appears anywhere in the donor payload;
* the element registers in the staff GET/PUT visibility registry;
* ``PublicOrphanDetail`` (the pre-sponsorship public card) stays sibling-free.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization

# The sibling card is EXACTLY this minimal slice — nothing may ever be added
# without a deliberate privacy review.
_SIBLING_CARD_KEYS = {"first_name", "age_years", "gender", "sponsorship_status", "code"}

# Distinctive VALUES planted on sibling rows so a leak of any staff-only field
# is caught even under a renamed key.
_PLANTED_SIBLING_PII = (
    "عائلة-الأشقاء-السرية",
    "أب-الأشقاء-السري",
    "BC-SIB-SECRET",
)


def _age_years(dob: date) -> int:
    """Expected age exactly as the public card derives it."""
    today = datetime.now(UTC).date()
    years = today.year - dob.year
    if (today.month, today.day) < (dob.month, dob.day):
        years -= 1
    return max(years, 0)


# ── Fixtures / helpers ─────────────────────────────────────────────────────


async def _partner_id(api: AsyncClient, headers: dict[str, str]) -> str:
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    return str(row["items"][0]["id"])


async def _make_family(api: AsyncClient, admin_headers: dict[str, str]) -> dict[str, Any]:
    r = await api.post(
        "/api/v1/families",
        json={
            "family_name": "عائلة-الأشقاء-السرية",
            "deceased_father_name": "أب-الأشقاء-السري",
            "country_code": "KW",
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
        "first_name": f"r4-{suffix}",
        "family_name": "عائلة-الأشقاء-السرية",
        "date_of_birth": "2014-03-01",
        "gender": "F",
        "nationality": "KW",
        "father_name": "أب-الأشقاء-السري",
        "birth_certificate_number": "BC-SIB-SECRET",
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
    email = f"r4-{suffix}@example.com"
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
    """Create a sponsorship (lands ``active`` — the platform's active
    predicate); returns its id so tests can drive lifecycle transitions."""
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


async def _sponsored_child_with_siblings(
    api: AsyncClient, admin_headers: dict[str, str]
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, str]]:
    """A donor sponsoring a child with two siblings: an OLDER one actively
    sponsored by another donor, and a YOUNGER one awaiting a sponsor. Returns
    (child, sponsored_sibling, awaiting_sibling, donor_headers)."""
    partner_id = await _partner_id(api, admin_headers)
    donor_id, donor_headers = await _signup_donor(api, admin_headers)
    family = await _make_family(api, admin_headers)

    child = await _make_orphan(api, admin_headers, partner_id, family_id=family["id"])
    older = await _make_orphan(
        api, admin_headers, partner_id, family_id=family["id"], date_of_birth="2010-06-15"
    )
    younger = await _make_orphan(
        api,
        admin_headers,
        partner_id,
        family_id=family["id"],
        date_of_birth="2018-09-20",
        gender="M",
    )

    await _make_sponsorship(api, admin_headers, donor_id, child["id"])
    other_donor_id, _ = await _signup_donor(api, admin_headers)
    await _make_sponsorship(api, admin_headers, other_donor_id, older["id"])
    return child, older, younger, donor_headers


# ── siblings — gating + minimal slice ──────────────────────────────────────


async def test_siblings_block_visible_with_data(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Visible (the default) + siblings on the family ⇒ one card per sibling,
    EXACTLY the allowlist, oldest first; the child itself is never a card."""
    child, older, younger, donor_headers = await _sponsored_child_with_siblings(api, auth_headers)

    body = await _sponsored_profile(api, donor_headers, child["id"])
    assert body["siblings"] is not None
    items = body["siblings"]["items"]
    assert [i["first_name"] for i in items] == [older["first_name"], younger["first_name"]]
    for item in items:
        assert set(item.keys()) == _SIBLING_CARD_KEYS
    # The child never appears among their own siblings.
    assert child["first_name"] not in [i["first_name"] for i in items]

    assert items[0] == {
        "first_name": older["first_name"],
        "age_years": _age_years(date(2010, 6, 15)),
        "gender": "F",
        "sponsorship_status": "sponsored",
        "code": None,
    }
    assert items[1] == {
        "first_name": younger["first_name"],
        "age_years": _age_years(date(2018, 9, 20)),
        "gender": "M",
        "sponsorship_status": "awaiting_sponsor",
        "code": younger["code"],
    }


async def test_siblings_block_omitted_when_hidden(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Hiding the element strips the whole block server-side even though the
    siblings exist — and no sibling value escapes anywhere else."""
    child, older, younger, donor_headers = await _sponsored_child_with_siblings(api, auth_headers)

    r = await api.put(
        f"/api/v1/orphans/{child['id']}/profile-visibility",
        json={"visibility": {"siblings": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _sponsored_profile(api, donor_headers, child["id"])
    assert body["siblings"] is None
    dumped = json.dumps(body, ensure_ascii=False)
    assert older["first_name"] not in dumped
    assert younger["first_name"] not in dumped
    assert younger["code"] not in dumped


async def test_siblings_block_omitted_without_family(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Visible but no linked family ⇒ the block is omitted (no empty shell)."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _make_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["siblings"] is None


async def test_siblings_block_omitted_without_siblings(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A family whose only child is the sponsored one emits no block — the
    child must never be listed as their own sibling."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    family = await _make_family(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id, family_id=family["id"])
    await _make_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["siblings"] is None


async def test_soft_deleted_sibling_excluded(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A soft-deleted sibling drops out; when it was the only one, the whole
    block collapses to None."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    family = await _make_family(api, auth_headers)
    child = await _make_orphan(api, auth_headers, partner_id, family_id=family["id"])
    sibling = await _make_orphan(api, auth_headers, partner_id, family_id=family["id"])
    await _make_sponsorship(api, auth_headers, donor_id, child["id"])

    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET deleted_at = now() WHERE id = :id"),
            {"id": sibling["id"]},
        )
        await db.commit()

    body = await _sponsored_profile(api, donor_headers, child["id"])
    assert body["siblings"] is None


# ── sponsorship_status — reuses the ACTIVE-sponsorship predicate ───────────


async def test_status_follows_active_sponsorship_lifecycle(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Only an ACTIVE sponsorship makes a sibling "sponsored": pausing it flips
    the card back to awaiting_sponsor — and the code reappears with it."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    family = await _make_family(api, auth_headers)
    child = await _make_orphan(api, auth_headers, partner_id, family_id=family["id"])
    sibling = await _make_orphan(api, auth_headers, partner_id, family_id=family["id"])
    await _make_sponsorship(api, auth_headers, donor_id, child["id"])

    other_donor_id, _ = await _signup_donor(api, auth_headers)
    sponsorship_id = await _make_sponsorship(api, auth_headers, other_donor_id, sibling["id"])

    body = await _sponsored_profile(api, donor_headers, child["id"])
    assert body["siblings"]["items"][0]["sponsorship_status"] == "sponsored"
    assert body["siblings"]["items"][0]["code"] is None

    r = await api.post(f"/api/v1/sponsorships/{sponsorship_id}/pause", headers=auth_headers)
    assert r.status_code == 200, r.text

    body = await _sponsored_profile(api, donor_headers, child["id"])
    assert body["siblings"]["items"][0]["sponsorship_status"] == "awaiting_sponsor"
    assert body["siblings"]["items"][0]["code"] == sibling["code"]


# ── Content safety — nothing else ever leaks ───────────────────────────────


async def test_sponsored_sibling_code_never_leaves_the_server(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A sponsored sibling's code appears NOWHERE in the donor payload — a
    donor must never be able to dereference another donor's child."""
    child, older, _younger, donor_headers = await _sponsored_child_with_siblings(api, auth_headers)

    body = await _sponsored_profile(api, donor_headers, child["id"])
    dumped = json.dumps(body, ensure_ascii=False)
    assert older["code"] not in dumped


async def test_no_sibling_pii_anywhere_in_payload(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """With the element visible and fully populated sibling rows, no planted
    sibling PII value and no sibling id appears ANYWHERE in the donor payload —
    the card is the allowlist and nothing more."""
    child, older, younger, donor_headers = await _sponsored_child_with_siblings(api, auth_headers)

    body = await _sponsored_profile(api, donor_headers, child["id"])
    dumped = json.dumps(body, ensure_ascii=False)
    for planted in _PLANTED_SIBLING_PII:
        assert planted not in dumped, f"planted sibling PII '{planted}' leaked into the payload"
    assert older["id"] not in dumped
    assert younger["id"] not in dumped


# ── Cross-org fence — the explicit organization_id filter ──────────────────


async def test_cross_org_orphan_never_returned_as_sibling(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Even when ANOTHER org's orphan shares the family_id (data corruption /
    hostile write), the donor never sees it as a sibling: the query filters by
    the orphan's organization_id explicitly, because the superuser DB
    connection bypasses RLS."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    family = await _make_family(api, auth_headers)
    child = await _make_orphan(api, auth_headers, partner_id, family_id=family["id"])
    await _make_sponsorship(api, auth_headers, donor_id, child["id"])

    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        other_org = Organization(
            code=f"R4X-{suffix}",
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
        # A FOREIGN-org orphan pointing at OUR family.
        db.add(
            Orphan(
                organization_id=other_org.id,
                partner_organization_id=foreign_partner.id,
                family_id=uuid.UUID(family["id"]),
                code=f"ORPX-{suffix}",
                first_name="شقيق-أجنبي",
                family_name="عائلة-أجنبية",
                date_of_birth=date(2012, 1, 1),
                gender="M",
            )
        )
        await db.commit()

    body = await _sponsored_profile(api, donor_headers, child["id"])
    # The foreign orphan is the only family_id match — so the block stays None.
    assert body["siblings"] is None
    dumped = json.dumps(body, ensure_ascii=False)
    assert "شقيق-أجنبي" not in dumped
    assert f"ORPX-{suffix}" not in dumped


# ── Staff visibility registry ──────────────────────────────────────────────


async def test_siblings_in_staff_registry(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """The new element appears in the staff GET registry (visible by default)
    and is accepted by the PUT."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)

    r = await api.get(f"/api/v1/orphans/{orphan['id']}/profile-visibility", headers=auth_headers)
    assert r.status_code == 200, r.text
    by_key = {e["key"]: e["visible"] for e in r.json()["elements"]}
    assert by_key["siblings"] is True

    r = await api.put(
        f"/api/v1/orphans/{orphan['id']}/profile-visibility",
        json={"visibility": {"siblings": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    by_key = {e["key"]: e["visible"] for e in r.json()["elements"]}
    assert by_key["siblings"] is False


# ── Public (pre-sponsorship) card stays sibling-free ───────────────────────


async def test_public_card_exposes_no_siblings(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """PublicOrphanCard/Detail are untouched: no siblings key or sponsorship
    standing reaches the public browse/detail surfaces even for a child whose
    family carries siblings in both states."""
    child, _older, _younger, _donor_headers = await _sponsored_child_with_siblings(
        api, auth_headers
    )
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status='available' WHERE id=:id"),
            {"id": child["id"]},
        )
        await db.commit()

    r = await api.get(f"/api/v1/public/orphans/{child['code']}")
    assert r.status_code == 200, r.text
    dumped = json.dumps(r.json(), ensure_ascii=False)
    for field in ("siblings", "sponsorship_status"):
        assert f'"{field}"' not in dumped, f"'{field}' leaked onto the public card"

    r = await api.get("/api/v1/public/orphans?limit=50")
    assert r.status_code == 200
    item = next(it for it in r.json()["items"] if it["code"] == child["code"])
    assert '"siblings"' not in json.dumps(item, ensure_ascii=False)
