"""GET /guardian/me + /guardian/me/orphans + /guardian/me/reports.

Privacy-critical: a guardian must only ever see the orphans tied to
THEIR family, and financial fields must not leak unless the org has
explicitly opted in via business_rules.show_financial_to_guardian.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session

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


async def _make_orphan_in_family(
    api: AsyncClient,
    admin_headers: dict[str, str],
    family_id: str,
    *,
    nickname: str = "y",
) -> str:
    """Create an orphan tied to `family_id`. Returns the orphan ID."""
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"{nickname}-{suffix}",
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
    orphan_id = r.json()["id"]
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET family_id = :fid WHERE id = :id"),
            {"fid": family_id, "id": orphan_id},
        )
        await db.commit()
    return orphan_id


async def _create_family_and_guardian(
    api: AsyncClient,
    admin_headers: dict[str, str],
) -> tuple[str, str, dict[str, str]]:
    """Provision a family, a guardian user (role='guardian'), a Guardian
    row linking them, and return (family_id, guardian_id, headers).

    Uses the invite/accept flow so we get a real verified-active user
    without bypassing the auth layer.
    """
    me = (await api.get("/api/v1/auth/me", headers=admin_headers)).json()
    org_id = me["organization_id"]

    # 1. Make a family row directly (no admin endpoint for raw create yet).
    family_id = str(uuid.uuid4())
    family_code = f"FAM-{uuid.uuid4().hex[:6].upper()}"
    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": org_id},
        )
        await db.execute(
            text(
                """
                INSERT INTO families (id, organization_id, code, family_name)
                VALUES (:id, :org, :code, :name)
                """
            ),
            {"id": family_id, "org": org_id, "code": family_code, "name": "guarded-family"},
        )
        await db.commit()

    # 2. Invite + accept a User row with role='guardian'.
    email = f"g-{uuid.uuid4().hex[:8]}@example.com"
    password = "guardpw123456"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": "Guardian",
            "last_name": "User",
            "role": "guardian",
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

    # 3. Insert a Guardian row referencing that user and the new family.
    guardian_id = str(uuid.uuid4())
    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": org_id},
        )
        await db.execute(
            text(
                """
                INSERT INTO guardians (
                    id, organization_id, family_id, user_id,
                    full_name, relation, literacy_level, preferred_communication
                )
                VALUES (
                    :id, :org, :fam, :uid,
                    :name, 'mother', 'low', 'whatsapp'
                )
                """
            ),
            {
                "id": guardian_id,
                "org": org_id,
                "fam": family_id,
                "uid": user_id,
                "name": f"G-{uuid.uuid4().hex[:6]}",
            },
        )
        await db.commit()

    # 4. Login.
    r = await api.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return family_id, guardian_id, headers


async def _set_show_financial(org_id: str, *, value: bool) -> None:
    """Upsert business_rules.show_financial_to_guardian for the org."""
    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": org_id},
        )
        await db.execute(
            text(
                """
                INSERT INTO business_rules (organization_id, show_financial_to_guardian)
                VALUES (:org, :v)
                ON CONFLICT (organization_id)
                DO UPDATE SET show_financial_to_guardian = EXCLUDED.show_financial_to_guardian
                """
            ),
            {"org": org_id, "v": value},
        )
        await db.commit()


# ── /guardian/me ───────────────────────────────────────────────────────


async def test_guardian_can_fetch_own_profile(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    _, guardian_id, headers = await _create_family_and_guardian(api, auth_headers)
    r = await api.get("/api/v1/guardian/me", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == guardian_id
    assert body["relation"] == "mother"
    assert body["family"] is not None
    assert body["family"]["family_name"] == "guarded-family"


async def test_non_guardian_user_gets_404_on_me(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The seed admin doesn't have a Guardian row — the endpoint must
    not confirm its existence."""
    r = await api.get("/api/v1/guardian/me", headers=auth_headers)
    assert r.status_code == 404


# ── /guardian/me/orphans ───────────────────────────────────────────────


async def test_guardian_lists_only_own_family_orphans(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_a, _, headers_a = await _create_family_and_guardian(api, auth_headers)
    family_b, _, headers_b = await _create_family_and_guardian(api, auth_headers)

    # One orphan per family.
    orphan_a = await _make_orphan_in_family(api, auth_headers, family_a, nickname="a")
    orphan_b = await _make_orphan_in_family(api, auth_headers, family_b, nickname="b")

    r = await api.get("/api/v1/guardian/me/orphans", headers=headers_a)
    assert r.status_code == 200
    ids_a = {o["id"] for o in r.json()}
    assert orphan_a in ids_a
    assert orphan_b not in ids_a  # isolation

    # Guardian B is isolated symmetrically.
    r = await api.get("/api/v1/guardian/me/orphans", headers=headers_b)
    ids_b = {o["id"] for o in r.json()}
    assert orphan_b in ids_b
    assert orphan_a not in ids_b


async def test_guardian_orphans_omit_financials_by_default(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    await _make_orphan_in_family(api, auth_headers, family_id)

    r = await api.get("/api/v1/guardian/me/orphans", headers=headers)
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    for item in items:
        # business_rules.show_financial_to_guardian defaults to FALSE.
        assert item.get("financials") is None
        # And the raw financial keys must never appear top-level either.
        for forbidden in ("current_balance", "is_sponsored", "balance_currency"):
            assert forbidden not in item, f"{forbidden} leaked even with show_financial=False"


async def test_guardian_orphans_include_financials_when_org_opts_in(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    me = (await api.get("/api/v1/auth/me", headers=auth_headers)).json()
    org_id = me["organization_id"]

    try:
        family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
        await _make_orphan_in_family(api, auth_headers, family_id)
        await _set_show_financial(org_id, value=True)

        r = await api.get("/api/v1/guardian/me/orphans", headers=headers)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        for item in items:
            assert item.get("financials") is not None
            assert "current_balance" in item["financials"]
            assert "is_sponsored" in item["financials"]
            assert "balance_currency" in item["financials"]
    finally:
        # Reset so we don't pollute other tests in the suite.
        await _set_show_financial(org_id, value=False)


# ── /guardian/me/reports ───────────────────────────────────────────────


async def test_guardian_can_list_own_orphan_reports(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)

    # Drop a draft report straight in (admin acts on behalf).
    r = await api.post(
        "/api/v1/reports",
        json={
            "orphan_id": orphan_id,
            "report_type": "monthly",
            "period_start": "2026-05-01",
            "period_end": "2026-05-31",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    r = await api.get(
        f"/api/v1/guardian/me/reports?orphan_id={orphan_id}",
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert any(item["id"] == rid for item in r.json())


async def test_guardian_cannot_list_reports_for_another_family(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_a, _, headers_a = await _create_family_and_guardian(api, auth_headers)
    family_b, _, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_b = await _make_orphan_in_family(api, auth_headers, family_b)

    r = await api.get(
        f"/api/v1/guardian/me/reports?orphan_id={orphan_b}",
        headers=headers_a,
    )
    assert r.status_code == 403


# ── /guardian/me/orphans (create — G-06) ───────────────────────────────


async def _link_family_to_partner(family_id: str, partner_id: str) -> None:
    """Attach a partner org to a family so the guardian create-orphan path can
    derive partner_organization_id (families are otherwise created without
    one in this suite)."""
    async with make_session() as db:
        await db.execute(
            text("UPDATE families SET partner_organization_id = :pid WHERE id = :fid"),
            {"pid": partner_id, "fid": family_id},
        )
        await db.commit()


def _orphan_payload(nickname: str = "n") -> dict[str, str]:
    suffix = uuid.uuid4().hex[:6]
    return {
        "first_name": f"{nickname}-{suffix}",
        "family_name": "Guarded",
        "date_of_birth": "2016-03-12",
        "gender": "M",
        "nationality": "KW",
        "father_name": f"father-{suffix}",
    }


async def test_guardian_creates_orphan_pending_review_in_own_family(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Happy path: a guardian registers a child; it lands pending_review,
    is linked to the guardian's OWN family + the family's partner org
    (derived server-side), and shows up in the guardian's own list."""
    partner_id = await _seed_partner_id()
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    await _link_family_to_partner(family_id, partner_id)

    r = await api.post(
        "/api/v1/guardian/me/orphans",
        json=_orphan_payload("new"),
        headers=headers,
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["code"].startswith("ORF-")
    assert created["case_status"] == "pending_review"
    # Privacy-safe projection: no donor identity / financial fields leak.
    assert created.get("financials") is None
    for forbidden in ("current_balance", "is_sponsored", "partner_organization_id"):
        assert forbidden not in created

    # Linked to the guardian's family + the family's partner org, server-side.
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT family_id::text, partner_organization_id::text "
                    "FROM orphans WHERE id = :id"
                ),
                {"id": created["id"]},
            )
        ).first()
    assert row is not None
    assert row[0] == family_id
    assert row[1] == partner_id

    # And it surfaces in the guardian's own list with the pending status.
    r = await api.get("/api/v1/guardian/me/orphans", headers=headers)
    assert r.status_code == 200
    mine = {o["id"]: o for o in r.json()}
    assert created["id"] in mine
    assert mine[created["id"]]["case_status"] == "pending_review"


async def test_guardian_created_orphan_rides_staff_approval_queue(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """No workflow fork: the guardian-created orphan appears in the staff
    pending_review queue and moves through the existing approve endpoint."""
    partner_id = await _seed_partner_id()
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    await _link_family_to_partner(family_id, partner_id)

    r = await api.post(
        "/api/v1/guardian/me/orphans", json=_orphan_payload("queue"), headers=headers
    )
    assert r.status_code == 201, r.text
    orphan_id = r.json()["id"]

    r = await api.get("/api/v1/orphans?case_status=pending_review&limit=100", headers=auth_headers)
    assert r.status_code == 200
    assert any(o["id"] == orphan_id for o in r.json()["items"])

    r = await api.post(f"/api/v1/orphans/{orphan_id}/approve", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["case_status"] == "approved"


async def test_guardian_cannot_create_orphan_for_another_family(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A guardian cannot smuggle family_id / partner_organization_id /
    organization_id through the body (extra='forbid' → 422), and a clean
    create only ever lands in the caller's OWN family."""
    partner_id = await _seed_partner_id()
    family_a, _, headers_a = await _create_family_and_guardian(api, auth_headers)
    family_b, _, _ = await _create_family_and_guardian(api, auth_headers)
    await _link_family_to_partner(family_a, partner_id)

    payload = _orphan_payload("evil")
    payload["family_id"] = family_b
    payload["partner_organization_id"] = partner_id
    payload["organization_id"] = "00000000-0000-0000-0000-000000000000"
    r = await api.post("/api/v1/guardian/me/orphans", json=payload, headers=headers_a)
    assert r.status_code == 422, r.text

    r = await api.post(
        "/api/v1/guardian/me/orphans", json=_orphan_payload("clean"), headers=headers_a
    )
    assert r.status_code == 201, r.text
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT family_id::text FROM orphans WHERE id = :id"),
                {"id": r.json()["id"]},
            )
        ).first()
    assert row is not None
    assert row[0] == family_a


async def test_guardian_create_orphan_duplicate_returns_409(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The canonical idx_orphans_no_duplicate rule is enforced for guardians
    too: a second identical submission → 409 (not 500), with the existing
    ORF code surfaced so the UI can link to it."""
    partner_id = await _seed_partner_id()
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    await _link_family_to_partner(family_id, partner_id)

    payload = _orphan_payload("dup")
    r = await api.post("/api/v1/guardian/me/orphans", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    existing_code = r.json()["code"]

    r = await api.post("/api/v1/guardian/me/orphans", json=payload, headers=headers)
    assert r.status_code == 409, r.text
    assert existing_code in r.json()["detail"]


async def test_guardian_create_orphan_requires_father_name(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """father_name is a required domain field — omitting it is a 422."""
    partner_id = await _seed_partner_id()
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    await _link_family_to_partner(family_id, partner_id)

    payload = _orphan_payload("nofather")
    del payload["father_name"]
    r = await api.post("/api/v1/guardian/me/orphans", json=payload, headers=headers)
    assert r.status_code == 422, r.text


async def test_guardian_with_no_partner_linked_family_gets_409(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """If the guardian's family has no partner organization, we never guess a
    default — the create returns a clear 409 rather than a blank/forged
    partner."""
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    # Deliberately do NOT link a partner to the family.

    r = await api.post(
        "/api/v1/guardian/me/orphans", json=_orphan_payload("nopartner"), headers=headers
    )
    assert r.status_code == 409, r.text


async def test_non_guardian_cannot_create_orphan_via_self_endpoint(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The seed admin has no Guardian row → 404 (the resource is the gate)."""
    r = await api.post(
        "/api/v1/guardian/me/orphans",
        json=_orphan_payload("admin"),
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text


async def test_guardian_self_create_leaves_orphanage_none(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A guardian-created orphan never gets a dar: orphanage_id stays NULL even
    though the column exists — the dar is a staff-only assignment."""
    partner_id = await _seed_partner_id()
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    await _link_family_to_partner(family_id, partner_id)

    r = await api.post(
        "/api/v1/guardian/me/orphans", json=_orphan_payload("nodar"), headers=headers
    )
    assert r.status_code == 201, r.text
    created = r.json()

    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT orphanage_id FROM orphans WHERE id = :id"),
                {"id": created["id"]},
            )
        ).first()
    assert row is not None
    assert row[0] is None


async def test_guardian_self_create_rejects_orphanage_id_field(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The guardian body forbids extra fields, so a client cannot smuggle an
    orphanage_id in to self-assign a dar → 422."""
    partner_id = await _seed_partner_id()
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    await _link_family_to_partner(family_id, partner_id)

    payload = _orphan_payload("smuggle")
    payload["orphanage_id"] = str(uuid.uuid4())
    r = await api.post("/api/v1/guardian/me/orphans", json=payload, headers=headers)
    assert r.status_code == 422, r.text
