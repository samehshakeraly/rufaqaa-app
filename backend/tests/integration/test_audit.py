import uuid

from httpx import AsyncClient


async def test_create_donor_records_audit_entry(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    suffix = uuid.uuid4().hex[:8]
    r = await api.post(
        "/api/v1/donors",
        json={"full_name": "كافل تجريبي", "email": f"audit-{suffix}@example.com"},
        headers=auth_headers,
    )
    assert r.status_code == 201
    donor_id = r.json()["id"]

    # Filter to the entity we just created — keeps the assertion stable
    # even though earlier tests add their own audit entries.
    r = await api.get(
        f"/api/v1/audit?entity_type=donor&entity_id={donor_id}&limit=5",
        headers=auth_headers,
    )
    assert r.status_code == 200
    page = r.json()
    assert page["total"] >= 1
    entry = page["items"][0]
    assert entry["action"] == "donor.created"
    assert entry["entity_id"] == donor_id
    assert entry["new_values"]["email"] == f"audit-{suffix}@example.com"


async def test_audit_list_filters_by_action(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get("/api/v1/audit?action=donor.created&limit=3", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    for item in body["items"]:
        assert item["action"] == "donor.created"
