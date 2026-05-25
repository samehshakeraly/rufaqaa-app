"""PATCH /orphans/{id} — partial updates + audit trail."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def test_patch_updates_only_supplied_fields(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]
    created = (
        await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"تعديل-{suffix}",
                "family_name": "أصلي",
                "date_of_birth": "2015-04-01",
                "gender": "M",
                "partner_organization_id": partner_id,
                "father_name": f"أب-{suffix}",
            },
            headers=auth_headers,
        )
    ).json()

    r = await api.patch(
        f"/api/v1/orphans/{created['id']}",
        json={"family_name": "محدث", "nationality": "EG"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["family_name"] == "محدث"
    assert body["nationality"] == "EG"
    assert body["first_name"] == created["first_name"]  # untouched

    # Audit captured both before/after
    audit = await api.get(
        f"/api/v1/audit?entity_type=orphan&entity_id={created['id']}&limit=5",
        headers=auth_headers,
    )
    assert audit.status_code == 200
    actions = [e["action"] for e in audit.json()["items"]]
    assert "orphan.updated" in actions


async def test_patch_404_for_unknown_orphan(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.patch(
        f"/api/v1/orphans/{uuid.uuid4()}",
        json={"family_name": "x"},
        headers=auth_headers,
    )
    assert r.status_code == 404
