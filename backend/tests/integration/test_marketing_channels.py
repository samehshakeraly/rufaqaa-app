"""CRUD round-trip on /marketing-channels."""

from __future__ import annotations

import uuid

from httpx import AsyncClient


async def test_marketing_channel_full_crud(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/marketing-channels",
        json={
            "name_ar": f"قناة-{suffix}",
            "name_en": f"Channel {suffix}",
            "channel_type": "digital_marketing",
            "description": "Paid social",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert r.json()["channel_type"] == "digital_marketing"
    assert r.json()["status"] == "active"

    r = await api.get(f"/api/v1/marketing-channels/{cid}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["name_en"] == f"Channel {suffix}"

    r = await api.patch(
        f"/api/v1/marketing-channels/{cid}",
        json={"name_en": "Renamed", "channel_type": "committee"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["name_en"] == "Renamed"
    assert r.json()["channel_type"] == "committee"

    r = await api.delete(f"/api/v1/marketing-channels/{cid}", headers=auth_headers)
    assert r.status_code == 204

    # archived channel is excluded from the default list
    r = await api.get("/api/v1/marketing-channels", headers=auth_headers)
    assert all(item["id"] != cid for item in r.json()["items"])

    # but is included when include_inactive=true
    r = await api.get("/api/v1/marketing-channels?include_inactive=true", headers=auth_headers)
    assert any(item["id"] == cid for item in r.json()["items"])


async def test_get_unknown_channel_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get(f"/api/v1/marketing-channels/{uuid.uuid4()}", headers=auth_headers)
    assert r.status_code == 404
