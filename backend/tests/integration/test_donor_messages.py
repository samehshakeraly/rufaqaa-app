"""Donor messaging (PR-D2): cross-org compose/send + read.

A self-signup donor lives in the PLATFORM org while the orphan and the
handling staff live in the partner (dev) org. These tests exercise the
DONOR-SCOPED message endpoints that bridge that gap — the generic
org-scoped /messages router cannot serve donors.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session

# MessageRead is a privacy-safe projection: it must NEVER leak raw user
# ids (or emails / last names). We assert the wire shape omits these.
FORBIDDEN_FIELDS = {"from_user_id", "to_user_id", "from_email", "to_email"}


async def _signup_and_verify(api: AsyncClient) -> tuple[str, dict[str, str]]:
    """Returns (donor_email, headers). The user is fully verified and lives
    in the PLATFORM org (self-signup)."""
    email = f"d-{uuid.uuid4().hex[:8]}@example.com"
    password = "longenoughpw1"
    r = await api.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": password, "full_name": "Test Donor"},
    )
    token = r.json()["debug_verify_token"]
    r = await api.post("/api/v1/auth/verify-email", json={"token": token})
    pair = r.json()
    return email, {"Authorization": f"Bearer {pair['access_token']}"}


async def _make_available_orphan(api: AsyncClient, headers: dict[str, str]) -> str:
    """Uses admin headers to provision an orphan in the dev org + flip its
    case to 'available' (publicly browseable + sponsorable)."""
    partner_id = (await api.get("/api/v1/partners", headers=headers)).json()["items"][0]["id"]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"O{uuid.uuid4().hex[:4]}",
            "family_name": "x",
            "date_of_birth": "2017-06-15",
            "gender": "F",
            "nationality": "KW",
            "father_name": "Test Father",
            "partner_organization_id": partner_id,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    code = r.json()["code"]
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status='available' WHERE code=:c"),
            {"c": code},
        )
        await db.commit()
    return code


async def _sponsor(api: AsyncClient, headers: dict[str, str], code: str) -> None:
    r = await api.post(
        "/api/v1/donor/me/sponsorships",
        json={"orphan_code": code, "monthly_amount": "25.00", "currency": "KWD"},
        headers=headers,
    )
    assert r.status_code == 201, r.text


async def test_donor_can_send_about_sponsored_orphan(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Cross-org happy path: donor (platform org) messages staff about a
    child they sponsor (dev org). Lands pending; the seed admin is an
    org_admin of the dev org, so recipient tier (c) resolves."""
    code = await _make_available_orphan(api, auth_headers)
    _, donor_headers = await _signup_and_verify(api)
    await _sponsor(api, donor_headers, code)

    r = await api.post(
        "/api/v1/donor/me/messages",
        json={"orphan_code": code, "content": "How is my child doing?"},
        headers=donor_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["moderation_status"] == "pending"
    assert body["is_mine"] is True
    assert body["orphan_code"] == code
    assert body["content"] == "How is my child doing?"
    # Privacy: no raw ids / emails on the wire.
    assert FORBIDDEN_FIELDS.isdisjoint(body.keys())


async def test_donor_cannot_send_about_non_sponsored_orphan(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Messaging about a child the donor does NOT sponsor 404s (existence
    is not revealed)."""
    code = await _make_available_orphan(api, auth_headers)
    _, donor_headers = await _signup_and_verify(api)
    # Deliberately do NOT sponsor.
    r = await api.post(
        "/api/v1/donor/me/messages",
        json={"orphan_code": code, "content": "hi"},
        headers=donor_headers,
    )
    assert r.status_code == 404, r.text


async def test_donor_cannot_send_about_unknown_orphan(api: AsyncClient) -> None:
    _, donor_headers = await _signup_and_verify(api)
    r = await api.post(
        "/api/v1/donor/me/messages",
        json={"orphan_code": "ORP-DOESNOTEXIST", "content": "hi"},
        headers=donor_headers,
    )
    assert r.status_code == 404, r.text


async def test_donor_lists_own_sent_message_cross_org(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A pending message is visible to its SENDER across orgs; a different
    donor never sees it."""
    code = await _make_available_orphan(api, auth_headers)
    _, donor_headers = await _signup_and_verify(api)
    await _sponsor(api, donor_headers, code)
    send = await api.post(
        "/api/v1/donor/me/messages",
        json={"orphan_code": code, "content": "Question for staff"},
        headers=donor_headers,
    )
    assert send.status_code == 201, send.text
    sent_id = send.json()["id"]

    r = await api.get("/api/v1/donor/me/messages", headers=donor_headers)
    assert r.status_code == 200, r.text
    page = r.json()
    ids = [m["id"] for m in page["items"]]
    assert sent_id in ids
    # Privacy holds on the list projection too.
    for m in page["items"]:
        assert FORBIDDEN_FIELDS.isdisjoint(m.keys())

    # A second, unrelated donor must not see the first donor's message.
    _, other_headers = await _signup_and_verify(api)
    r2 = await api.get("/api/v1/donor/me/messages", headers=other_headers)
    assert r2.status_code == 200, r2.text
    other_ids = [m["id"] for m in r2.json()["items"]]
    assert sent_id not in other_ids


async def test_orphan_code_filter_narrows_and_unknown_is_empty(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    code_a = await _make_available_orphan(api, auth_headers)
    code_b = await _make_available_orphan(api, auth_headers)
    _, donor_headers = await _signup_and_verify(api)
    await _sponsor(api, donor_headers, code_a)
    await _sponsor(api, donor_headers, code_b)

    sa = await api.post(
        "/api/v1/donor/me/messages",
        json={"orphan_code": code_a, "content": "about A"},
        headers=donor_headers,
    )
    assert sa.status_code == 201, sa.text
    sb = await api.post(
        "/api/v1/donor/me/messages",
        json={"orphan_code": code_b, "content": "about B"},
        headers=donor_headers,
    )
    assert sb.status_code == 201, sb.text

    # Filter to A only.
    r = await api.get(
        "/api/v1/donor/me/messages",
        params={"orphan_code": code_a},
        headers=donor_headers,
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items
    assert all(m["orphan_code"] == code_a for m in items)

    # Unknown code -> empty page.
    r = await api.get(
        "/api/v1/donor/me/messages",
        params={"orphan_code": "ORP-NOPE"},
        headers=donor_headers,
    )
    assert r.status_code == 200, r.text
    page = r.json()
    assert page["items"] == []
    assert page["total"] == 0


async def test_recipient_tier_b_prefers_partner_staff_over_org_admin(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """When the orphan's partner org has an active partner_staff/manager,
    that user is chosen over the org_admin fallback (tier b > tier c)."""
    code = await _make_available_orphan(api, auth_headers)

    # Discover the orphan's partner org + org, then plant an active
    # partner_staff user on that partner org.
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT partner_organization_id, organization_id FROM orphans WHERE code=:c"),
                {"c": code},
            )
        ).first()
        assert row is not None
        partner_org_id, org_id = row
        staff_email = f"staff-{uuid.uuid4().hex[:8]}@example.com"
        await db.execute(
            text(
                "INSERT INTO users (id, organization_id, partner_organization_id, "
                "email, password_hash, first_name, last_name, role, status) "
                "VALUES (gen_random_uuid(), :org, :porg, :email, 'x', "
                "'Staff', 'Member', 'partner_staff', 'active')"
            ),
            {"org": org_id, "porg": partner_org_id, "email": staff_email},
        )
        await db.commit()
        staff_id = await db.scalar(text("SELECT id FROM users WHERE email=:e"), {"e": staff_email})

    _, donor_headers = await _signup_and_verify(api)
    await _sponsor(api, donor_headers, code)
    send = await api.post(
        "/api/v1/donor/me/messages",
        json={"orphan_code": code, "content": "for staff"},
        headers=donor_headers,
    )
    assert send.status_code == 201, send.text
    msg_id = send.json()["id"]
    _ = staff_id  # planted so tier (b) has at least one candidate

    # Verify the recipient resolved via tier (b): an active partner-role
    # user of the orphan's partner org — NOT the org_admin tier-(c) fallback.
    async with make_session() as db:
        recipient = (
            await db.execute(
                text(
                    "SELECT u.role, u.partner_organization_id, u.status "
                    "FROM messages m JOIN users u ON u.id = m.to_user_id "
                    "WHERE m.id = :i"
                ),
                {"i": msg_id},
            )
        ).first()
    assert recipient is not None
    role, recipient_partner_org_id, recipient_status = recipient
    assert role in ("partner_manager", "partner_staff")
    assert str(recipient_partner_org_id) == str(partner_org_id)
    assert recipient_status == "active"
