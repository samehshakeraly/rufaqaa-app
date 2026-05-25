import uuid

from httpx import AsyncClient


async def test_family_with_guardians_full_roundtrip(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/families",
        json={
            "family_name": f"عائلة-{suffix}",
            "country_code": "KW",
            "city": "Kuwait City",
            "housing_status": "rented",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    family = r.json()
    fid = family["id"]
    assert family["code"].startswith("FAM-")

    r = await api.get(f"/api/v1/families/{fid}", headers=auth_headers)
    assert r.status_code == 200

    r = await api.post(
        f"/api/v1/families/{fid}/guardians",
        json={
            "full_name": "أم اليتيم",
            "relation": "mother",
            "phone": "+96599887766",
            "literacy_level": "medium",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    guardian = r.json()
    assert guardian["family_id"] == fid

    r = await api.get(f"/api/v1/families/{fid}/guardians", headers=auth_headers)
    assert r.status_code == 200
    page = r.json()
    assert page["total"] >= 1
    assert any(g["id"] == guardian["id"] for g in page["items"])


async def test_guardian_create_404_for_unknown_family(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    bogus = str(uuid.uuid4())
    r = await api.post(
        f"/api/v1/families/{bogus}/guardians",
        json={"full_name": "x", "relation": "mother"},
        headers=auth_headers,
    )
    assert r.status_code == 404
