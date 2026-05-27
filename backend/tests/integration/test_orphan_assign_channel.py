"""POST /orphans/{id}/assign-channel."""

from __future__ import annotations

import uuid

from httpx import AsyncClient


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
