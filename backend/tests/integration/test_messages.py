"""Messages — moderated comms between donors and guardians.

Privacy is the whole point: a donor and a guardian must never see each
other's email/phone/last name; pending messages must not reach the
recipient until approved; rejected messages stay visible to the sender
(but not recipient) so disputes have a trail.
"""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session

# ── Helpers ────────────────────────────────────────────────────────────


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT id::text FROM partner_organizations "
                    "WHERE code = 'DEV-PTN' LIMIT 1"
                )
            )
        ).first()
        assert row is not None
        return row[0]


async def _signup_donor(api: AsyncClient) -> tuple[str, str, dict[str, str]]:
    """Returns (user_id, email, headers)."""
    email = f"d-{uuid.uuid4().hex[:8]}@example.com"
    password = "longenoughpw1"
    await api.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": password, "full_name": "Dani Donor"},
    )
    # Pull the debug token to verify.
    r = await api.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": password, "full_name": "Dani Donor"},
    )
    # First signup succeeded already; second returns the same token shape.
    debug_token = r.json().get("debug_verify_token")
    if debug_token is None:
        # First call should still have given us one — re-issue path.
        r2 = await api.post(
            "/api/v1/auth/resend-verification", json={"email": email}
        )
        debug_token = r2.json()["debug_verify_token"]
    r = await api.post("/api/v1/auth/verify-email", json={"token": debug_token})
    assert r.status_code == 200, r.text
    pair = r.json()
    headers = {"Authorization": f"Bearer {pair['access_token']}"}
    me = (await api.get("/api/v1/auth/me", headers=headers)).json()
    return me["id"], email, headers


async def _invite_user(
    api: AsyncClient, admin_headers: dict[str, str], role: str
) -> tuple[str, str, dict[str, str]]:
    """Invite + accept + login a user with `role`. Returns (user_id, email, headers)."""
    email = f"{role[:3]}-{uuid.uuid4().hex[:8]}@example.com"
    password = "longenoughpw1"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": role.title(),
            "last_name": "Userton",
            "role": role,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    user_id = r.json()["user"]["id"]
    token = r.json()["invite_token"]
    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": token, "password": password},
    )
    assert r.status_code == 200, r.text
    r = await api.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return user_id, email, headers


async def _make_orphan(api: AsyncClient, admin_headers: dict[str, str]) -> str:
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"m-{suffix}",
            "family_name": "Test",
            "date_of_birth": "2016-03-12",
            "gender": "M",
            "nationality": "KW",
            "partner_organization_id": partner_id,
            "father_name": f"father-{suffix}",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _move_donor_to_admin_org(donor_user_id: str, admin_headers_org: str) -> None:
    """Donors signed up via /auth/signup land in the PLATFORM org. For
    our message tests we need the donor in the admin's org so RLS lets
    them talk to a guardian on the same org.
    """
    async with make_session() as db:
        await db.execute(
            text("UPDATE users SET organization_id = :org WHERE id = :id"),
            {"org": admin_headers_org, "id": donor_user_id},
        )
        await db.commit()


async def _admin_org_id(api: AsyncClient, admin_headers: dict[str, str]) -> str:
    me = (await api.get("/api/v1/auth/me", headers=admin_headers)).json()
    return me["organization_id"]


# ── Privacy: no raw IDs / emails / phones in projections ───────────────


_FORBIDDEN_KEYS = {
    "from_user_id",
    "to_user_id",
    "email",
    "phone",
    "last_name",
    "from_email",
    "to_email",
    "from_phone",
    "to_phone",
    "from_last_name",
    "to_last_name",
}


def _assert_privacy_safe(payload: Any) -> None:
    """Walk the payload and assert no PII-leak keys appear anywhere."""
    if isinstance(payload, dict):
        for k, v in payload.items():
            assert k not in _FORBIDDEN_KEYS, f"forbidden key '{k}' present: {payload}"
            _assert_privacy_safe(v)
    elif isinstance(payload, list):
        for item in payload:
            _assert_privacy_safe(item)


# ── Test setup builder ────────────────────────────────────────────────


async def _setup_conversation(
    api: AsyncClient, auth_headers: dict[str, str]
) -> dict[str, Any]:
    """Provision: org, orphan, donor (in admin's org), guardian.
    Returns dict of ids/headers handy for tests.
    """
    org_id = await _admin_org_id(api, auth_headers)
    donor_id, donor_email, donor_h = await _signup_donor(api)
    await _move_donor_to_admin_org(donor_id, org_id)
    guardian_id, guardian_email, guardian_h = await _invite_user(
        api, auth_headers, "guardian"
    )
    orphan_id = await _make_orphan(api, auth_headers)
    return {
        "org_id": org_id,
        "donor_id": donor_id,
        "donor_email": donor_email,
        "donor_h": donor_h,
        "guardian_id": guardian_id,
        "guardian_email": guardian_email,
        "guardian_h": guardian_h,
        "orphan_id": orphan_id,
    }


# ── Happy path ─────────────────────────────────────────────────────────


async def test_donor_sends_moderator_approves_guardian_sees(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    ctx = await _setup_conversation(api, auth_headers)

    # Donor sends a message.
    r = await api.post(
        "/api/v1/messages",
        json={
            "to_user_id": ctx["guardian_id"],
            "related_orphan_id": ctx["orphan_id"],
            "content": "May Allah bless your family",
        },
        headers=ctx["donor_h"],
    )
    assert r.status_code == 201, r.text
    sent = r.json()
    _assert_privacy_safe(sent)
    assert sent["moderation_status"] == "pending"
    assert sent["is_mine"] is True
    message_id = sent["id"]

    # Recipient does NOT see it yet.
    r = await api.get(
        f"/api/v1/messages?orphan_id={ctx['orphan_id']}", headers=ctx["guardian_h"]
    )
    assert r.status_code == 200
    assert all(item["id"] != message_id for item in r.json()["items"])

    # Sender sees their pending message.
    r = await api.get(
        f"/api/v1/messages?orphan_id={ctx['orphan_id']}", headers=ctx["donor_h"]
    )
    assert r.status_code == 200
    assert any(item["id"] == message_id for item in r.json()["items"])

    # Moderator (admin) approves.
    r = await api.post(
        f"/api/v1/messages/{message_id}/moderate",
        json={"decision": "approve", "notes": "looks fine"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["moderation_status"] == "approved"

    # Recipient now sees it.
    r = await api.get(
        f"/api/v1/messages?orphan_id={ctx['orphan_id']}", headers=ctx["guardian_h"]
    )
    assert r.status_code == 200
    body = r.json()
    _assert_privacy_safe(body)
    assert any(item["id"] == message_id for item in body["items"])


# ── Privacy ────────────────────────────────────────────────────────────


async def test_message_projection_hides_pii(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    ctx = await _setup_conversation(api, auth_headers)
    r = await api.post(
        "/api/v1/messages",
        json={
            "to_user_id": ctx["guardian_id"],
            "related_orphan_id": ctx["orphan_id"],
            "content": "Hello",
        },
        headers=ctx["donor_h"],
    )
    assert r.status_code == 201, r.text
    sent = r.json()
    _assert_privacy_safe(sent)
    # Only first names + roles + orphan_code may surface.
    assert "from_name" in sent
    assert "from_role" in sent
    assert "to_name" in sent
    assert "to_role" in sent
    # The donor's email + the guardian's email must not appear anywhere.
    serialised = str(sent)
    assert ctx["donor_email"] not in serialised
    assert ctx["guardian_email"] not in serialised
    # Last names (the invite_user helper uses "Userton") must not surface.
    assert "Userton" not in serialised


# ── Moderation ─────────────────────────────────────────────────────────


async def test_pending_message_invisible_to_recipient(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    ctx = await _setup_conversation(api, auth_headers)
    r = await api.post(
        "/api/v1/messages",
        json={
            "to_user_id": ctx["guardian_id"],
            "related_orphan_id": ctx["orphan_id"],
            "content": "Pending until reviewed",
        },
        headers=ctx["donor_h"],
    )
    mid = r.json()["id"]

    r = await api.get(f"/api/v1/messages/{mid}", headers=ctx["guardian_h"])
    assert r.status_code == 403  # not visible until approved


async def test_partner_staff_cannot_moderate(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    ctx = await _setup_conversation(api, auth_headers)
    r = await api.post(
        "/api/v1/messages",
        json={
            "to_user_id": ctx["guardian_id"],
            "related_orphan_id": ctx["orphan_id"],
            "content": "X",
        },
        headers=ctx["donor_h"],
    )
    mid = r.json()["id"]

    _, _, staff_h = await _invite_user(api, auth_headers, "partner_staff")
    r = await api.post(
        f"/api/v1/messages/{mid}/moderate",
        json={"decision": "approve"},
        headers=staff_h,
    )
    assert r.status_code == 403


async def test_rejected_message_visible_to_sender_invisible_to_recipient(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    ctx = await _setup_conversation(api, auth_headers)
    r = await api.post(
        "/api/v1/messages",
        json={
            "to_user_id": ctx["guardian_id"],
            "related_orphan_id": ctx["orphan_id"],
            "content": "spammy bits",
        },
        headers=ctx["donor_h"],
    )
    mid = r.json()["id"]

    r = await api.post(
        f"/api/v1/messages/{mid}/moderate",
        json={"decision": "reject", "notes": "off-topic"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["moderation_status"] == "rejected"

    # Sender still sees the rejected message + can read the moderator notes.
    r = await api.get(f"/api/v1/messages/{mid}", headers=ctx["donor_h"])
    assert r.status_code == 200
    body = r.json()
    assert body["moderation_status"] == "rejected"
    assert body["moderation_notes"] == "off-topic"

    # Recipient does NOT see the rejected message.
    r = await api.get(f"/api/v1/messages/{mid}", headers=ctx["guardian_h"])
    assert r.status_code == 403


# ── Isolation ──────────────────────────────────────────────────────────


async def test_donor_cannot_read_other_donors_message(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    ctx = await _setup_conversation(api, auth_headers)
    # Second donor in the same org but uninvolved with this conversation.
    other_donor_id, _, other_donor_h = await _signup_donor(api)
    await _move_donor_to_admin_org(other_donor_id, ctx["org_id"])

    r = await api.post(
        "/api/v1/messages",
        json={
            "to_user_id": ctx["guardian_id"],
            "related_orphan_id": ctx["orphan_id"],
            "content": "Private",
        },
        headers=ctx["donor_h"],
    )
    mid = r.json()["id"]

    # GET → 403 for the uninvolved donor (sender or recipient only).
    r = await api.get(f"/api/v1/messages/{mid}", headers=other_donor_h)
    assert r.status_code == 403

    # And the message must not appear in their list either.
    r = await api.get("/api/v1/messages", headers=other_donor_h)
    assert r.status_code == 200
    assert all(item["id"] != mid for item in r.json()["items"])


async def test_guardian_only_sees_own_conversations_via_list(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Two donors, two guardians. Each donor messages a different
    guardian. Guardian B must not see the donor→guardian A message
    even when filtering by orphan_id (guardian A's orphan)."""
    ctx_a = await _setup_conversation(api, auth_headers)
    # Re-use the same admin org but add an unrelated guardian.
    other_guardian_id, _, other_guardian_h = await _invite_user(
        api, auth_headers, "guardian"
    )

    r = await api.post(
        "/api/v1/messages",
        json={
            "to_user_id": ctx_a["guardian_id"],
            "related_orphan_id": ctx_a["orphan_id"],
            "content": "Hello guardian A",
        },
        headers=ctx_a["donor_h"],
    )
    mid = r.json()["id"]
    # Approve it.
    await api.post(
        f"/api/v1/messages/{mid}/moderate",
        json={"decision": "approve"},
        headers=auth_headers,
    )
    _ = other_guardian_id

    # The other guardian sees nothing on this orphan.
    r = await api.get(
        f"/api/v1/messages?orphan_id={ctx_a['orphan_id']}",
        headers=other_guardian_h,
    )
    assert r.status_code == 200
    assert all(item["id"] != mid for item in r.json()["items"])
