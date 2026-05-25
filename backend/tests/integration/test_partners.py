import uuid

from httpx import AsyncClient


async def test_partner_full_crud(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/partners",
        json={
            "name_ar": f"شريك-{suffix}",
            "name_en": f"Partner {suffix}",
            "country_code": "KW",
            "contact_email": f"p-{suffix}@example.com",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert r.json()["code"].startswith("PTN-")

    r = await api.get(f"/api/v1/partners/{pid}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "active"

    r = await api.patch(
        f"/api/v1/partners/{pid}",
        json={"name_en": "Updated"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["name_en"] == "Updated"

    r = await api.delete(f"/api/v1/partners/{pid}", headers=auth_headers)
    assert r.status_code == 204

    r = await api.get(f"/api/v1/partners/{pid}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "archived"

    # archived partner is excluded from the default list
    r = await api.get("/api/v1/partners", headers=auth_headers)
    assert all(item["id"] != pid for item in r.json()["items"])

    # but is included when include_inactive=true
    r = await api.get("/api/v1/partners?include_inactive=true", headers=auth_headers)
    assert any(item["id"] == pid for item in r.json()["items"])
