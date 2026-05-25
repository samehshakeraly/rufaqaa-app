"""PATCH /donors/{id}."""

from __future__ import annotations

import uuid

from httpx import AsyncClient


async def test_patch_donor_updates_supplied_fields(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    suffix = uuid.uuid4().hex[:6]
    created = (
        await api.post(
            "/api/v1/donors",
            json={
                "full_name": f"محسن-{suffix}",
                "email": f"patch-{suffix}@example.com",
            },
            headers=auth_headers,
        )
    ).json()

    r = await api.patch(
        f"/api/v1/donors/{created['id']}",
        json={"phone": "+96599887766", "country_of_residence": "AE"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["phone"] == "+96599887766"
    assert r.json()["country_of_residence"] == "AE"
    # email left alone
    assert r.json()["email"] == created["email"]


async def test_patch_donor_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.patch(
        f"/api/v1/donors/{uuid.uuid4()}",
        json={"phone": "x"},
        headers=auth_headers,
    )
    assert r.status_code == 404
