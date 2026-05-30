"""GET/POST /orphan/me + /sponsor + /achievements + /messages.

Privacy-critical, because the viewer is a child:

  * Only orphans aged 12+ with a provisioned User row may use the portal;
    an under-12 account is refused with 403 AGE_GATE on every endpoint.
  * The "my sponsor" view must NEVER leak donor identity, amount, or
    currency — only a generic display name + a start year.
  * Achievements only ever surface `published_to_donor` reports.
  * Messages expose `from_role` + `from_name` (first name) only.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session

# A DOB old enough to clear the 12+ gate, and one too young (under 12).
DOB_12_PLUS = "2010-01-01"
DOB_UNDER_12 = "2018-01-01"


# ── Helpers ────────────────────────────────────────────────────────────


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def _org_id(api: AsyncClient, admin_headers: dict[str, str]) -> str:
    me = (await api.get("/api/v1/auth/me", headers=admin_headers)).json()
    return str(me["organization_id"])


async def _create_orphan_with_user(
    api: AsyncClient,
    admin_headers: dict[str, str],
    *,
    dob: str = DOB_12_PLUS,
    nickname: str = "child",
    family_id: str | None = None,
) -> tuple[str, str, dict[str, str]]:
    """Provision an orphan User (role='orphan'), an Orphan row linked to
    it, and return (orphan_id, user_id, headers).
    """
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]

    # 1. Create the Orphan row via the admin endpoint.
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"{nickname}-{suffix}",
            "family_name": "Orphan",
            "date_of_birth": dob,
            "gender": "M",
            "nationality": "KW",
            "partner_organization_id": partner_id,
            "father_name": f"father-{suffix}",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    orphan_id = r.json()["id"]

    # 2. Invite + accept a User row with role='orphan'.
    email = f"o-{uuid.uuid4().hex[:8]}@example.com"
    password = "orphanpw123456"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": "Orphan",
            "last_name": "User",
            "role": "orphan",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    invite_token = r.json()["invite_token"]
    user_id = r.json()["user"]["id"]

    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": invite_token, "password": password},
    )
    assert r.status_code == 200, r.text

    # 3. Link the user (and optional family) onto the orphan row.
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET user_id = :uid, family_id = :fid WHERE id = :id"),
            {"uid": user_id, "fid": family_id, "id": orphan_id},
        )
        await db.commit()

    # 4. Login as the orphan.
    r = await api.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return orphan_id, user_id, headers


async def _create_active_sponsorship(
    org_id: str,
    orphan_id: str,
    *,
    donor_first_name: str = "Khalid",
    donor_email: str = "secret-donor@example.com",
    monthly_amount: str = "99.50",
    currency: str = "USD",
) -> str:
    """Insert a donor + active sponsorship directly. Returns donor_id."""
    donor_id = str(uuid.uuid4())
    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": org_id},
        )
        await db.execute(
            text(
                """
                INSERT INTO donors (id, organization_id, code, full_name, email, status)
                VALUES (:id, :org, :code, :name, :email, 'active')
                """
            ),
            {
                "id": donor_id,
                "org": org_id,
                "code": f"DON-{uuid.uuid4().hex[:6].upper()}",
                "name": f"{donor_first_name} Al-Secret",
                "email": donor_email,
            },
        )
        await db.execute(
            text(
                """
                INSERT INTO sponsorships (
                    id, organization_id, code, donor_id, orphan_id,
                    monthly_amount, currency, start_date, status
                )
                VALUES (
                    :id, :org, :code, :donor, :orphan,
                    :amount, :currency, DATE '2024-03-01', 'active'
                )
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "org": org_id,
                "code": f"KAF-{uuid.uuid4().hex[:6].upper()}",
                "donor": donor_id,
                "orphan": orphan_id,
                "amount": monthly_amount,
                "currency": currency,
            },
        )
        await db.commit()
    return donor_id


async def _insert_report(org_id: str, orphan_id: str, *, status_value: str) -> str:
    report_id = str(uuid.uuid4())
    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": org_id},
        )
        await db.execute(
            text(
                """
                INSERT INTO orphan_reports (
                    id, organization_id, orphan_id, report_type,
                    period_start, period_end, educational_progress, status
                )
                VALUES (
                    :id, :org, :orphan, 'monthly',
                    DATE '2026-04-01', DATE '2026-04-30',
                    '{"grade": "A"}'::jsonb, :status
                )
                """
            ),
            {"id": report_id, "org": org_id, "orphan": orphan_id, "status": status_value},
        )
        await db.commit()
    return report_id


async def _set_show_donor_first_name(org_id: str, *, value: bool) -> None:
    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": org_id},
        )
        await db.execute(
            text(
                """
                INSERT INTO business_rules (organization_id, show_donor_first_name_to_orphan)
                VALUES (:org, :v)
                ON CONFLICT (organization_id)
                DO UPDATE SET show_donor_first_name_to_orphan = EXCLUDED.show_donor_first_name_to_orphan
                """
            ),
            {"org": org_id, "v": value},
        )
        await db.commit()


# ── /orphan/me ───────────────────────────────────────────────────────


async def test_orphan_12plus_fetches_own_profile(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, _, headers = await _create_orphan_with_user(api, auth_headers)
    r = await api.get("/api/v1/orphan/me", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == orphan_id
    assert body["date_of_birth"] == DOB_12_PLUS
    # No financial / partner / guardian fields ever.
    for forbidden in (
        "current_balance",
        "is_sponsored",
        "balance_currency",
        "partner_organization_id",
        "monthly_amount",
    ):
        assert forbidden not in body, f"{forbidden} leaked from /orphan/me"


async def test_non_orphan_user_gets_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """The seed admin has no Orphan row — the endpoint must not confirm
    that /orphan/me is reachable."""
    for path in ("/me", "/me/sponsor", "/me/achievements", "/me/messages"):
        r = await api.get(f"/api/v1/orphan{path}", headers=auth_headers)
        assert r.status_code == 404, f"{path} -> {r.status_code}"


# ── Age gate ───────────────────────────────────────────────────────────


async def test_under_12_orphan_blocked_on_every_endpoint(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    _, _, headers = await _create_orphan_with_user(api, auth_headers, dob=DOB_UNDER_12)

    gets = ("/me", "/me/sponsor", "/me/achievements", "/me/messages")
    for path in gets:
        r = await api.get(f"/api/v1/orphan{path}", headers=headers)
        assert r.status_code == 403, f"{path} -> {r.status_code}"
        assert r.json()["detail"]["code"] == "AGE_GATE", path

    r = await api.post(
        "/api/v1/orphan/me/messages",
        json={"content": "hello"},
        headers=headers,
    )
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "AGE_GATE"


# ── Isolation ──────────────────────────────────────────────────────────


async def test_orphan_a_cannot_see_orphan_b_data(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    org_id = await _org_id(api, auth_headers)
    orphan_a, _, headers_a = await _create_orphan_with_user(api, auth_headers, nickname="a")
    orphan_b, _, headers_b = await _create_orphan_with_user(api, auth_headers, nickname="b")

    # B has a published report; A must never see it.
    await _insert_report(org_id, orphan_b, status_value="published_to_donor")

    # A sees only its own profile.
    r = await api.get("/api/v1/orphan/me", headers=headers_a)
    assert r.json()["id"] == orphan_a

    # A's achievements never include B's report (A has none of its own).
    r = await api.get("/api/v1/orphan/me/achievements", headers=headers_a)
    assert r.status_code == 200
    assert r.json() == []

    # B does see its own report.
    r = await api.get("/api/v1/orphan/me/achievements", headers=headers_b)
    assert any(item["id"] for item in r.json())


# ── Sponsor projection ─────────────────────────────────────────────────


async def test_sponsor_view_never_leaks_donor_identity(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    org_id = await _org_id(api, auth_headers)
    orphan_id, _, headers = await _create_orphan_with_user(api, auth_headers)
    await _create_active_sponsorship(
        org_id,
        orphan_id,
        donor_first_name="Khalid",
        donor_email="secret-donor@example.com",
        monthly_amount="99.50",
        currency="USD",
    )

    # Default: show_donor_first_name_to_orphan is FALSE -> generic name.
    r = await api.get("/api/v1/orphan/me/sponsor", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["has_sponsor"] is True
    assert body["display_name"] == "كفيلك"
    assert body["since_year"] == 2024

    raw = r.text
    for forbidden in (
        "Khalid",
        "Al-Secret",
        "secret-donor@example.com",
        "99.50",
        "99.5",
        "USD",
    ):
        assert forbidden not in raw, f"{forbidden} leaked in sponsor view"
    # And none of these keys should exist at all.
    for key in ("donor_id", "amount", "currency", "sponsorship_id", "email", "phone"):
        assert key not in body, f"{key} present in sponsor view"


async def test_sponsor_view_shows_first_name_when_opted_in(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    org_id = await _org_id(api, auth_headers)
    try:
        orphan_id, _, headers = await _create_orphan_with_user(api, auth_headers)
        await _create_active_sponsorship(org_id, orphan_id, donor_first_name="Khalid")
        await _set_show_donor_first_name(org_id, value=True)

        r = await api.get("/api/v1/orphan/me/sponsor", headers=headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["display_name"] == "Khalid"
        # Even opted-in, only the first name — never the family name.
        assert "Al-Secret" not in r.text
    finally:
        await _set_show_donor_first_name(org_id, value=False)


async def test_sponsor_view_no_sponsor(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    _, _, headers = await _create_orphan_with_user(api, auth_headers)
    r = await api.get("/api/v1/orphan/me/sponsor", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"has_sponsor": False, "display_name": None, "since_year": None}


# ── Achievements ───────────────────────────────────────────────────────


async def test_achievements_only_published(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    org_id = await _org_id(api, auth_headers)
    orphan_id, _, headers = await _create_orphan_with_user(api, auth_headers)

    published_id = await _insert_report(org_id, orphan_id, status_value="published_to_donor")
    await _insert_report(org_id, orphan_id, status_value="draft")
    await _insert_report(org_id, orphan_id, status_value="pending_partner_approval")

    r = await api.get("/api/v1/orphan/me/achievements", headers=headers)
    assert r.status_code == 200, r.text
    items = r.json()
    ids = {item["id"] for item in items}
    assert published_id in ids
    assert len(items) == 1, "only the published report should surface"

    item = items[0]
    # Progress fields present; clinical / financial / submitter dropped.
    assert "educational_progress" in item
    for forbidden in ("health_status", "psychological_status", "submitted_by", "summary"):
        assert forbidden not in item, f"{forbidden} leaked in achievement"


# ── Messages ───────────────────────────────────────────────────────────


async def test_orphan_message_compose_and_projection(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, user_id, headers = await _create_orphan_with_user(api, auth_headers)

    # Compose -> lands as pending, projected with from_role/from_name only.
    r = await api.post(
        "/api/v1/orphan/me/messages",
        json={"content": "I finished my homework!"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["moderation_status"] == "pending"
    assert body["from_role"] == "orphan"
    assert body["from_name"] == "Orphan"
    assert body["is_mine"] is True
    # No recipient PII or raw ids in the projection.
    for forbidden in ("to_user_id", "from_user_id", "to_name", "email", "phone", "last_name"):
        assert forbidden not in body, f"{forbidden} leaked in message projection"

    # The message is forced onto the orphan's own context server-side.
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT related_orphan_id::text, from_user_id::text FROM messages WHERE id = :id"
                ),
                {"id": body["id"]},
            )
        ).first()
    assert row is not None
    assert row[0] == orphan_id
    assert row[1] == user_id


async def test_orphan_lists_only_approved_messages(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, _, headers = await _create_orphan_with_user(api, auth_headers)

    # One pending (just composed) and one we approve out-of-band.
    await api.post(
        "/api/v1/orphan/me/messages",
        json={"content": "pending one"},
        headers=headers,
    )
    r = await api.post(
        "/api/v1/orphan/me/messages",
        json={"content": "approved one"},
        headers=headers,
    )
    approved_id = r.json()["id"]
    async with make_session() as db:
        await db.execute(
            text("UPDATE messages SET moderation_status = 'approved' WHERE id = :id"),
            {"id": approved_id},
        )
        await db.commit()

    r = await api.get("/api/v1/orphan/me/messages", headers=headers)
    assert r.status_code == 200, r.text
    items = r.json()
    ids = {item["id"] for item in items}
    assert approved_id in ids
    assert all(item["moderation_status"] == "approved" for item in items)
    for item in items:
        for forbidden in ("to_user_id", "from_user_id", "to_name", "email", "phone"):
            assert forbidden not in item
