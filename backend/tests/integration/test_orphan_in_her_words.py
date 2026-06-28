"""Curated "In Her Words" (بكلماتها) child phrases — donor-profile element (PR-8).

A supervisor-authored, ordered list of short child phrases governed by the
existing per-element visibility map. Exercised here:

* staff ``PUT`` then donor ``GET`` of the composed profile surfaces the block
  with the right ``text``/``said_on`` and in the PUT-controlled order, while the
  internal id NEVER leaks to the donor;
* hiding the element via ``profile-visibility`` OMITS the block; an empty list
  also omits it;
* a different-org staff member cannot read or write this org's orphan (the
  explicit org filter holds — superuser RLS bypass notwithstanding);
* a donor who does not sponsor the child 404s on the profile (existing scope);
* validation: empty text, >280 chars, >20 items and a future ``said_on`` are all
  rejected (422).

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
    email = f"ihw-{suffix}@example.com"
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


async def _make_orphan(api: AsyncClient, admin_headers: dict[str, str], partner_id: str) -> str:
    suffix = uuid.uuid4().hex[:6]
    body = {
        "first_name": f"ihw-{suffix}",
        "family_name": "Secret",
        "date_of_birth": "2014-03-01",
        "gender": "F",
        "nationality": "KW",
        "father_name": f"father-{suffix}",
        "partner_organization_id": partner_id,
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


async def _sponsored_child(
    api: AsyncClient, admin_headers: dict[str, str]
) -> tuple[str, str, dict[str, str]]:
    """A donor sponsoring a freshly created child. Returns
    (orphan_id, donor_id, donor_headers)."""
    partner_id = await _partner_id(api, admin_headers)
    donor_id, donor_headers = await _signup_donor(api, admin_headers)
    orphan_id = await _make_orphan(api, admin_headers, partner_id)
    await _activate_sponsorship(api, admin_headers, donor_id, orphan_id)
    return orphan_id, donor_id, donor_headers


async def _profile(api: AsyncClient, headers: dict[str, str], orphan_id: str) -> dict[str, Any]:
    r = await api.get(f"/api/v1/me/sponsorships/{orphan_id}/profile", headers=headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


async def _other_org_admin(api: AsyncClient) -> dict[str, str]:
    """Create a separate org + an org_admin in it; return its auth headers."""
    suffix = uuid4().hex[:6]
    email = f"otherorg-ihw-{suffix}@example.com"
    password = "otherorgpw123456"
    async with make_session() as db:
        org = Organization(
            code=f"IHW-{suffix}",
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


# ── Round-trip: staff PUT → donor GET ──────────────────────────────────────


async def test_staff_put_then_donor_get(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id, _donor_id, donor_headers = await _sponsored_child(api, auth_headers)

    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/in-her-words",
        json=[
            {"text": "أحبّ القراءة كثيرًا", "said_on": "2026-02-10"},
            {"text": "أريد أن أصبح طبيبة"},
        ],
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["text"] for i in items] == ["أحبّ القراءة كثيرًا", "أريد أن أصبح طبيبة"]
    assert items[0]["said_on"] == "2026-02-10"
    assert items[1]["said_on"] is None
    # The staff contract carries stable ids.
    assert all(i["id"] for i in items)

    body = await _profile(api, donor_headers, orphan_id)
    assert body["in_her_words"] == [
        {"text": "أحبّ القراءة كثيرًا", "said_on": "2026-02-10"},
        {"text": "أريد أن أصبح طبيبة", "said_on": None},
    ]
    # The internal id NEVER reaches the donor.
    assert all("id" not in item for item in body["in_her_words"])


async def test_put_reuses_supplied_id_and_orders(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, _donor_id, _donor_headers = await _sponsored_child(api, auth_headers)

    first = (
        await api.put(
            f"/api/v1/orphans/{orphan_id}/in-her-words",
            json=[{"text": "phrase one"}, {"text": "phrase two"}],
            headers=auth_headers,
        )
    ).json()["items"]
    kept_id = first[0]["id"]

    # Reorder + re-use the first id; the staff GET reflects new order.
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/in-her-words",
        json=[{"text": "phrase two"}, {"id": kept_id, "text": "phrase one edited"}],
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items[0]["text"] == "phrase two"
    assert items[1]["id"] == kept_id
    assert items[1]["text"] == "phrase one edited"

    got = (await api.get(f"/api/v1/orphans/{orphan_id}/in-her-words", headers=auth_headers)).json()[
        "items"
    ]
    assert [i["text"] for i in got] == ["phrase two", "phrase one edited"]


# ── Hidden / empty ⇒ block omitted ─────────────────────────────────────────


async def test_hidden_element_omitted(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id, _donor_id, donor_headers = await _sponsored_child(api, auth_headers)
    await api.put(
        f"/api/v1/orphans/{orphan_id}/in-her-words",
        json=[{"text": "أحبّ المدرسة"}],
        headers=auth_headers,
    )

    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/profile-visibility",
        json={"visibility": {"in_her_words": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _profile(api, donor_headers, orphan_id)
    assert body["in_her_words"] is None
    assert "profile_visibility" not in body


async def test_empty_list_omitted(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id, _donor_id, donor_headers = await _sponsored_child(api, auth_headers)
    # No phrases set at all.
    body = await _profile(api, donor_headers, orphan_id)
    assert body["in_her_words"] is None

    # Explicitly clearing to an empty array also omits the block.
    await api.put(
        f"/api/v1/orphans/{orphan_id}/in-her-words",
        json=[{"text": "temp"}],
        headers=auth_headers,
    )
    await api.put(f"/api/v1/orphans/{orphan_id}/in-her-words", json=[], headers=auth_headers)
    body = await _profile(api, donor_headers, orphan_id)
    assert body["in_her_words"] is None


# ── Cross-org / scope ──────────────────────────────────────────────────────


async def test_cross_org_staff_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A staff member from another organization cannot read or write this org's
    orphan — 404, never a leak (the explicit org filter holds)."""
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    other_headers = await _other_org_admin(api)

    r = await api.get(f"/api/v1/orphans/{orphan_id}/in-her-words", headers=other_headers)
    assert r.status_code == 404
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/in-her-words",
        json=[{"text": "intruder"}],
        headers=other_headers,
    )
    assert r.status_code == 404


async def test_non_sponsoring_donor_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A donor who does not sponsor the child 404s on the profile (existing
    sponsorship scope), so the block is unreachable to them."""
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    await api.put(
        f"/api/v1/orphans/{orphan_id}/in-her-words",
        json=[{"text": "private"}],
        headers=auth_headers,
    )
    _other_donor_id, other_donor_headers = await _signup_donor(api, auth_headers)
    r = await api.get(f"/api/v1/me/sponsorships/{orphan_id}/profile", headers=other_donor_headers)
    assert r.status_code == 404


# ── Validation ─────────────────────────────────────────────────────────────


async def test_empty_text_rejected(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/in-her-words",
        json=[{"text": "   "}],
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


async def test_too_long_text_rejected(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/in-her-words",
        json=[{"text": "x" * 281}],
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


async def test_too_many_items_rejected(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/in-her-words",
        json=[{"text": f"phrase {n}"} for n in range(21)],
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


async def test_future_said_on_rejected(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/in-her-words",
        json=[{"text": "said in the future", "said_on": "2099-01-01"}],
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


async def test_donor_rejected_on_staff_endpoints(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    _donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)

    r = await api.get(f"/api/v1/orphans/{orphan_id}/in-her-words", headers=donor_headers)
    assert r.status_code == 403
    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/in-her-words",
        json=[{"text": "nope"}],
        headers=donor_headers,
    )
    assert r.status_code == 403
