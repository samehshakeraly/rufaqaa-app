"""Report scoping: guardian access checks + reviewer-role gates.

Pairs with the guardian self-portal tests. The fixtures here are a tiny
restatement of `test_guardian_self.py`'s helper to keep this file
standalone (so a future delete of one doesn't ripple to the other).
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session


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


async def _make_orphan_in_family(
    api: AsyncClient,
    admin_headers: dict[str, str],
    family_id: str,
) -> str:
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"r-{suffix}",
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
) -> tuple[str, dict[str, str]]:
    """Provision (family, guardian-user, headers). Returns (family_id,
    auth_headers).
    """
    me = (await api.get("/api/v1/auth/me", headers=admin_headers)).json()
    org_id = me["organization_id"]

    family_id = str(uuid.uuid4())
    family_code = f"FAM-{uuid.uuid4().hex[:6].upper()}"
    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": org_id},
        )
        await db.execute(
            text(
                "INSERT INTO families (id, organization_id, code, family_name) "
                "VALUES (:id, :org, :code, 'scope-family')"
            ),
            {"id": family_id, "org": org_id, "code": family_code},
        )
        await db.commit()

    email = f"g-{uuid.uuid4().hex[:8]}@example.com"
    password = "guardpw123456"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": "Scope",
            "last_name": "Guardian",
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

    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": org_id},
        )
        await db.execute(
            text(
                "INSERT INTO guardians (id, organization_id, family_id, user_id, "
                "full_name, relation) "
                "VALUES (gen_random_uuid(), :org, :fam, :uid, :name, 'mother')"
            ),
            {
                "org": org_id,
                "fam": family_id,
                "uid": user_id,
                "name": f"G-{uuid.uuid4().hex[:6]}",
            },
        )
        await db.commit()

    r = await api.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert r.status_code == 200, r.text
    return family_id, {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _login_as(
    api: AsyncClient, admin_headers: dict[str, str], role: str
) -> dict[str, str]:
    """Invite + accept + login a generic user with `role`."""
    email = f"{role[:3]}-{uuid.uuid4().hex[:8]}@example.com"
    password = "longenoughpw1"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": role.title(),
            "last_name": "User",
            "role": role,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    token = r.json()["invite_token"]
    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": token, "password": password},
    )
    assert r.status_code == 200, r.text
    r = await api.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _make_draft_report(
    api: AsyncClient, admin_headers: dict[str, str], orphan_id: str
) -> str:
    r = await api.post(
        "/api/v1/reports",
        json={
            "orphan_id": orphan_id,
            "report_type": "monthly",
            "period_start": "2026-04-01",
            "period_end": "2026-04-30",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ── Per-report ownership (guardian) ────────────────────────────────────


async def test_guardian_can_read_patch_submit_own_report(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_id, headers = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)
    rid = await _make_draft_report(api, auth_headers, orphan_id)

    # GET
    r = await api.get(f"/api/v1/reports/{rid}", headers=headers)
    assert r.status_code == 200, r.text

    # PATCH
    r = await api.patch(
        f"/api/v1/reports/{rid}",
        json={"summary": "تقدم ممتاز"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["summary"] == "تقدم ممتاز"

    # POST /submit
    r = await api.post(f"/api/v1/reports/{rid}/submit", json={}, headers=headers)
    assert r.status_code == 200
    assert r.json()["status"] == "pending_partner_approval"


async def test_guardian_cannot_read_patch_submit_other_family_report(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_a, headers_a = await _create_family_and_guardian(api, auth_headers)
    family_b, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_b = await _make_orphan_in_family(api, auth_headers, family_b)
    rid = await _make_draft_report(api, auth_headers, orphan_b)
    _ = family_a

    for method, path in [
        ("get", f"/api/v1/reports/{rid}"),
        ("patch", f"/api/v1/reports/{rid}"),
        ("post", f"/api/v1/reports/{rid}/submit"),
    ]:
        if method == "get":
            r = await api.get(path, headers=headers_a)
        elif method == "patch":
            r = await api.patch(path, json={"summary": "nope"}, headers=headers_a)
        else:
            r = await api.post(path, json={}, headers=headers_a)
        assert r.status_code == 403, f"{method} {path} → {r.status_code} (expected 403)"


# ── Create-report scoping ──────────────────────────────────────────────


async def test_guardian_cannot_create_report_for_another_family(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_a, headers_a = await _create_family_and_guardian(api, auth_headers)
    family_b, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_b = await _make_orphan_in_family(api, auth_headers, family_b)
    _ = family_a

    r = await api.post(
        "/api/v1/reports",
        json={
            "orphan_id": orphan_b,
            "report_type": "monthly",
            "period_start": "2026-04-01",
            "period_end": "2026-04-30",
        },
        headers=headers_a,
    )
    assert r.status_code == 403


async def test_guardian_can_create_report_for_own_orphan(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_id, headers = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)

    r = await api.post(
        "/api/v1/reports",
        json={
            "orphan_id": orphan_id,
            "report_type": "monthly",
            "period_start": "2026-04-01",
            "period_end": "2026-04-30",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text


# ── Workflow role gates ───────────────────────────────────────────────


async def test_partner_staff_cannot_approve_partner(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The four review transitions are now role-gated to
    REPORT_REVIEWER_ROLES = partner_manager + admins. partner_staff
    must 403."""
    family_id, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)
    rid = await _make_draft_report(api, auth_headers, orphan_id)

    # Advance to pending_partner_approval as admin first.
    r = await api.post(f"/api/v1/reports/{rid}/submit", json={}, headers=auth_headers)
    assert r.status_code == 200

    staff_headers = await _login_as(api, auth_headers, "partner_staff")
    for action in ("approve-partner", "approve-org", "publish", "reject"):
        body: dict[str, object] = {"reason": "x"} if action == "reject" else {}
        r = await api.post(f"/api/v1/reports/{rid}/{action}", json=body, headers=staff_headers)
        assert r.status_code == 403, f"{action} → {r.status_code} (expected 403)"
