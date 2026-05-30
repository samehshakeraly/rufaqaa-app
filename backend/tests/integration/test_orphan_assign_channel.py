"""POST /orphans/{id}/assign-channel + GET /orphans channel/assignment filters."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User


async def _make_orphan_and_channel(api: AsyncClient, headers: dict[str, str]) -> tuple[str, str]:
    # Need a partner for the orphan
    partner_id = (await api.get("/api/v1/partners", headers=headers)).json()["items"][0]["id"]

    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"Ch{uuid.uuid4().hex[:4]}",
            "family_name": "Test",
            "date_of_birth": "2017-06-15",
            "gender": "F",
            "nationality": "KW",
            "partner_organization_id": partner_id,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    orphan_id = r.json()["id"]

    r = await api.post(
        "/api/v1/marketing-channels",
        json={
            "name_ar": f"قناة-{uuid.uuid4().hex[:6]}",
            "name_en": "Test channel",
            "channel_type": "digital_marketing",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return orphan_id, r.json()["id"]


async def test_assign_and_unassign_channel(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id, channel_id = await _make_orphan_and_channel(api, auth_headers)

    # 1. assign
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/assign-channel",
        json={"channel_id": channel_id},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    # OrphanRead doesn't surface assigned_to_channel_id today; assert
    # via the audit log instead.
    r = await api.get(
        f"/api/v1/audit?entity_type=orphan&entity_id={orphan_id}",
        headers=auth_headers,
    )
    if r.status_code == 200:
        actions = [item["action"] for item in r.json().get("items", [])]
        assert "orphan.channel_assigned" in actions

    # 2. unassign with null
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/assign-channel",
        json={"channel_id": None},
        headers=auth_headers,
    )
    assert r.status_code == 200


async def test_assign_unknown_channel_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id, _ = await _make_orphan_and_channel(api, auth_headers)
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/assign-channel",
        json={"channel_id": str(uuid.uuid4())},
        headers=auth_headers,
    )
    assert r.status_code == 404


async def test_assign_archived_channel_409(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id, channel_id = await _make_orphan_and_channel(api, auth_headers)
    # Archive the channel first
    r = await api.delete(f"/api/v1/marketing-channels/{channel_id}", headers=auth_headers)
    assert r.status_code == 204

    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/assign-channel",
        json={"channel_id": channel_id},
        headers=auth_headers,
    )
    assert r.status_code == 409


# ── GET /orphans?channel_id + assignment_status ─────────────────────────


async def _set_deadline(orphan_id: str, deadline: datetime) -> None:
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET assignment_deadline = :d WHERE id = :id"),
            {"d": deadline, "id": orphan_id},
        )
        await db.commit()


async def test_channel_id_filter(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id, channel_id = await _make_orphan_and_channel(api, auth_headers)
    other_orphan, _ = await _make_orphan_and_channel(api, auth_headers)

    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/assign-channel",
        json={"channel_id": channel_id},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    r = await api.get(f"/api/v1/orphans?channel_id={channel_id}&limit=100", headers=auth_headers)
    assert r.status_code == 200, r.text
    ids = {item["id"] for item in r.json()["items"]}
    assert orphan_id in ids
    assert other_orphan not in ids
    # The new field is surfaced on the read model.
    match = next(item for item in r.json()["items"] if item["id"] == orphan_id)
    assert match["assigned_to_channel_id"] == channel_id


async def test_channel_id_filter_no_match_returns_empty(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get(f"/api/v1/orphans?channel_id={uuid.uuid4()}", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["items"] == []


async def test_assignment_status_active_vs_expired(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    active_orphan, channel_id = await _make_orphan_and_channel(api, auth_headers)
    expired_orphan, _ = await _make_orphan_and_channel(api, auth_headers)
    for oid in (active_orphan, expired_orphan):
        r = await api.post(
            f"/api/v1/orphans/{oid}/assign-channel",
            json={"channel_id": channel_id},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
    now = datetime.now(UTC)
    await _set_deadline(active_orphan, now + timedelta(days=10))
    await _set_deadline(expired_orphan, now - timedelta(days=10))

    r = await api.get(
        f"/api/v1/orphans?channel_id={channel_id}&assignment_status=active&limit=100",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    ids = {item["id"] for item in r.json()["items"]}
    assert active_orphan in ids
    assert expired_orphan not in ids

    r = await api.get(
        f"/api/v1/orphans?channel_id={channel_id}&assignment_status=expired&limit=100",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    ids = {item["id"] for item in r.json()["items"]}
    assert expired_orphan in ids
    assert active_orphan not in ids


async def test_assignment_status_invalid_422(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/orphans?assignment_status=bogus", headers=auth_headers)
    assert r.status_code == 422


async def test_channel_filter_tenant_isolation(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, channel_id = await _make_orphan_and_channel(api, auth_headers)
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/assign-channel",
        json={"channel_id": channel_id},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    # A user from another org sees none of this org's orphans.
    suffix = uuid.uuid4().hex[:8]
    email = f"oth-{suffix}@other.example.com"
    password = "otherpw123456"
    async with make_session() as db:
        org = Organization(
            code=f"OTO-{suffix[:6].upper()}",
            name_ar="منظمة أخرى",
            name_en="Other Org",
            org_type="standalone",
            deployment_mode="self_hosted",
            country_code="KW",
        )
        db.add(org)
        await db.flush()
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
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    other = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = await api.get(f"/api/v1/orphans?channel_id={channel_id}&limit=100", headers=other)
    assert r.status_code == 200, r.text
    assert orphan_id not in {item["id"] for item in r.json()["items"]}
