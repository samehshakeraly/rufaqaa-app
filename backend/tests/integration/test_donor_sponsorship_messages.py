"""PR-9 — sponsorship-scoped donor message archive ("أرشيف رسائلك إليها").

These exercise the donor-portal surface mounted under ``/me``:

  * POST /me/sponsorships/{orphan_id}/messages — the donor sends a note to a
    child they sponsor. Every routing field (recipient, orphan, sponsorship,
    org) is SERVER-DERIVED — the body carries only the text; a recipient/orphan
    smuggled into the body is ignored. The message lands ``pending`` with NO
    recipient (the orphanage routes it on approval). A non-sponsored / foreign
    orphan 404s without leaking existence.
  * GET /me/sponsorships/{orphan_id}/messages — the donor's own archive, ALL
    statuses, newest-first, projected so a rejected note still reaches the
    sender and no internal ids leak.

Plus the orphanage-side hardening on the generic /messages router:

  * the pending queue is narrowed to a جهة-bound partner_manager's own orphans
    while admins keep the org-wide queue;
  * a reject decision requires a non-empty reason (422 otherwise).

A donor here is org-scoped (lives in the admin's dev org), so the portal's
own-check (Donor.user_id → sponsorship) resolves within one organization.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session

# The privacy-safe projection must never leak raw ids / emails / last names.
_FORBIDDEN_FIELDS = {
    "from_user_id",
    "to_user_id",
    "email",
    "phone",
    "last_name",
    "from_email",
    "to_email",
}


# ── Setup helpers ──────────────────────────────────────────────────────


async def _partner_id(api: AsyncClient, headers: dict[str, str]) -> str:
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    return str(row["items"][0]["id"])


async def _create_partner(api: AsyncClient, headers: dict[str, str]) -> str:
    r = await api.post(
        "/api/v1/partners",
        json={"name_ar": f"جهة-{uuid.uuid4().hex[:5]}", "country_code": "KW"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def _signup_donor(
    api: AsyncClient, admin_headers: dict[str, str]
) -> tuple[str, dict[str, str]]:
    """Create an org-scoped donor + linked user; return (donor_id, headers)."""
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
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    async with make_session() as db:
        await db.execute(
            text("UPDATE donors SET user_id = :uid WHERE id = :did"),
            {"uid": user_id, "did": donor_id},
        )
        await db.commit()
    return donor_id, headers


async def _invite_partner_manager(
    api: AsyncClient, admin_headers: dict[str, str], partner_id: str
) -> dict[str, str]:
    """Invite + accept a partner_manager bound to ``partner_id``."""
    suffix = uuid.uuid4().hex[:8]
    email = f"pm-{suffix}@example.com"
    password = "longenoughpw1"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": "Partner",
            "last_name": "Manager",
            "role": "partner_manager",
            "partner_organization_id": partner_id,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    token = r.json()["invite_token"]
    r = await api.post("/api/v1/users/accept-invite", json={"token": token, "password": password})
    assert r.status_code == 200, r.text
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _make_orphan(api: AsyncClient, admin_headers: dict[str, str], partner_id: str) -> str:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"msg-{suffix}",
            "family_name": "Test",
            "date_of_birth": "2015-03-01",
            "gender": "F",
            "nationality": "KW",
            "father_name": f"father-{suffix}",
            "partner_organization_id": partner_id,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def _activate_sponsorship(
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
    sp_id = str(r.json()["id"])
    await api.post(f"/api/v1/sponsorships/{sp_id}/activate", headers=admin_headers)
    return sp_id


# ── POST: send ─────────────────────────────────────────────────────────


async def test_donor_sends_to_sponsored_orphan(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan)

    r = await api.post(
        f"/api/v1/me/sponsorships/{orphan}/messages",
        json={"content": "  How are you, dear child?  "},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["moderation_status"] == "pending"
    assert body["is_mine"] is True
    # Content is trimmed server-side.
    assert body["content"] == "How are you, dear child?"
    assert _FORBIDDEN_FIELDS.isdisjoint(body.keys())

    # The row is recipient-less + carries the derived sponsorship/orphan/org.
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT to_user_id, related_orphan_id, related_sponsorship_id, "
                    "organization_id FROM messages WHERE id = :i"
                ),
                {"i": body["id"]},
            )
        ).first()
    assert row is not None
    to_user_id, related_orphan_id, related_sponsorship_id, org_id = row
    assert to_user_id is None
    assert str(related_orphan_id) == orphan
    assert related_sponsorship_id is not None
    assert org_id is not None


async def test_body_cannot_set_routing_fields(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Recipient / orphan smuggled into the body are ignored — the server
    derives every routing field from the resolved sponsorship."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan)

    bogus = str(uuid.uuid4())
    r = await api.post(
        f"/api/v1/me/sponsorships/{orphan}/messages",
        json={
            "content": "hi",
            "to_user_id": bogus,
            "related_orphan_id": bogus,
            "related_sponsorship_id": bogus,
            "organization_id": bogus,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT to_user_id, related_orphan_id FROM messages WHERE id = :i"
                ),
                {"i": r.json()["id"]},
            )
        ).first()
    assert row is not None
    to_user_id, related_orphan_id = row
    assert to_user_id is None  # NOT the smuggled recipient
    assert str(related_orphan_id) == orphan  # the path param, not the body


async def test_send_to_non_sponsored_orphan_404s(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    _, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    # Deliberately do NOT sponsor.
    r = await api.post(
        f"/api/v1/me/sponsorships/{orphan}/messages",
        json={"content": "hi"},
        headers=headers,
    )
    assert r.status_code == 404, r.text


async def test_send_to_unknown_orphan_404s(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    _, headers = await _signup_donor(api, auth_headers)
    r = await api.post(
        f"/api/v1/me/sponsorships/{uuid.uuid4()}/messages",
        json={"content": "hi"},
        headers=headers,
    )
    assert r.status_code == 404, r.text


async def test_empty_content_422s(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan)
    r = await api.post(
        f"/api/v1/me/sponsorships/{orphan}/messages",
        json={"content": "   "},
        headers=headers,
    )
    assert r.status_code == 422, r.text


async def test_overlong_content_422s(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan)
    r = await api.post(
        f"/api/v1/me/sponsorships/{orphan}/messages",
        json={"content": "x" * 2001},
        headers=headers,
    )
    assert r.status_code == 422, r.text


# ── GET: archive ───────────────────────────────────────────────────────


async def test_archive_returns_own_messages_all_statuses(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The archive carries every status; a rejected message still reaches the
    sender WITH its moderation note, and the projection leaks no PII."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan)

    # Three notes: one stays pending, one approved, one rejected.
    ids = []
    for body in ("pending one", "approved one", "rejected one"):
        r = await api.post(
            f"/api/v1/me/sponsorships/{orphan}/messages",
            json={"content": body},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])

    await api.post(
        f"/api/v1/messages/{ids[1]}/moderate",
        json={"decision": "approve"},
        headers=auth_headers,
    )
    rej = await api.post(
        f"/api/v1/messages/{ids[2]}/moderate",
        json={"decision": "reject", "notes": "off-topic"},
        headers=auth_headers,
    )
    assert rej.status_code == 200, rej.text

    r = await api.get(f"/api/v1/me/sponsorships/{orphan}/messages", headers=headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    by_id = {m["id"]: m for m in items}
    assert set(ids).issubset(by_id.keys())
    assert by_id[ids[0]]["moderation_status"] == "pending"
    assert by_id[ids[1]]["moderation_status"] == "approved"
    assert by_id[ids[2]]["moderation_status"] == "rejected"
    # Rejected note reaches the sender.
    assert by_id[ids[2]]["moderation_notes"] == "off-topic"
    # No PII anywhere in the projection.
    for m in items:
        assert _FORBIDDEN_FIELDS.isdisjoint(m.keys())
    # Newest-first.
    created = [m["created_at"] for m in items]
    assert created == sorted(created, reverse=True)


async def test_archive_excludes_other_donors_and_other_orphans(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    donor_a, headers_a = await _signup_donor(api, auth_headers)
    orphan_a = await _make_orphan(api, auth_headers, partner_id)
    orphan_b = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_a, orphan_a)
    await _activate_sponsorship(api, auth_headers, donor_a, orphan_b)

    send_a = await api.post(
        f"/api/v1/me/sponsorships/{orphan_a}/messages",
        json={"content": "for A"},
        headers=headers_a,
    )
    mid_a = send_a.json()["id"]
    await api.post(
        f"/api/v1/me/sponsorships/{orphan_b}/messages",
        json={"content": "for B"},
        headers=headers_a,
    )

    # Archive of A carries only A's note (not B's).
    r = await api.get(f"/api/v1/me/sponsorships/{orphan_a}/messages", headers=headers_a)
    items = r.json()["items"]
    assert [m["id"] for m in items] == [mid_a]

    # A different donor sponsoring A sees none of donor-A's messages.
    donor_c, headers_c = await _signup_donor(api, auth_headers)
    await _activate_sponsorship(api, auth_headers, donor_c, orphan_a)
    r = await api.get(f"/api/v1/me/sponsorships/{orphan_a}/messages", headers=headers_c)
    assert r.status_code == 200, r.text
    assert all(m["id"] != mid_a for m in r.json()["items"])


async def test_archive_for_non_sponsored_orphan_404s(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    _, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    r = await api.get(f"/api/v1/me/sponsorships/{orphan}/messages", headers=headers)
    assert r.status_code == 404, r.text


# ── Orphanage moderation: queue narrowing + reject reason ───────────────


async def test_pending_queue_narrowed_for_partner_manager(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A جهة-bound partner_manager sees only their orphans' pending messages;
    the admin sees the org-wide queue (both)."""
    partner_a = await _create_partner(api, auth_headers)
    partner_b = await _create_partner(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan_a = await _make_orphan(api, auth_headers, partner_a)
    orphan_b = await _make_orphan(api, auth_headers, partner_b)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan_a)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan_b)

    msg_a = (
        await api.post(
            f"/api/v1/me/sponsorships/{orphan_a}/messages",
            json={"content": "about A"},
            headers=donor_headers,
        )
    ).json()["id"]
    msg_b = (
        await api.post(
            f"/api/v1/me/sponsorships/{orphan_b}/messages",
            json={"content": "about B"},
            headers=donor_headers,
        )
    ).json()["id"]

    mgr_headers = await _invite_partner_manager(api, auth_headers, partner_a)
    r = await api.get("/api/v1/messages/pending?limit=100", headers=mgr_headers)
    assert r.status_code == 200, r.text
    mgr_ids = {m["id"] for m in r.json()["items"]}
    assert msg_a in mgr_ids
    assert msg_b not in mgr_ids  # other جهة's message is hidden from this manager

    # The admin (org-wide) still sees both — the narrowing is additive.
    r = await api.get("/api/v1/messages/pending?limit=100", headers=auth_headers)
    admin_ids = {m["id"] for m in r.json()["items"]}
    assert {msg_a, msg_b}.issubset(admin_ids)


async def test_reject_without_reason_422s(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _activate_sponsorship(api, auth_headers, donor_id, orphan)
    mid = (
        await api.post(
            f"/api/v1/me/sponsorships/{orphan}/messages",
            json={"content": "please reject me"},
            headers=headers,
        )
    ).json()["id"]

    # Reject with no reason / blank reason → 422.
    r = await api.post(
        f"/api/v1/messages/{mid}/moderate",
        json={"decision": "reject"},
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text
    r = await api.post(
        f"/api/v1/messages/{mid}/moderate",
        json={"decision": "reject", "notes": "   "},
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text

    # A reason makes it pass.
    r = await api.post(
        f"/api/v1/messages/{mid}/moderate",
        json={"decision": "reject", "notes": "not appropriate"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["moderation_status"] == "rejected"
