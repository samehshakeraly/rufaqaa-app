"""Full-text search on /orphans."""

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


async def test_search_by_code_prefix(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"بحث-{suffix}",
            "family_name": "اختبار",
            "date_of_birth": "2014-01-01",
            "gender": "M",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{suffix}",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201
    created = r.json()
    code_prefix = created["code"][:6]  # e.g. ORF-AB

    r = await api.get(f"/api/v1/orphans?q={code_prefix}", headers=auth_headers)
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(item["id"] == created["id"] for item in items)


async def test_search_by_first_name_substring(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    needle = uuid.uuid4().hex[:8]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"يوسف-{needle}",
            "family_name": "البحث",
            "date_of_birth": "2013-02-02",
            "gender": "M",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{needle}",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201
    created = r.json()

    r = await api.get(f"/api/v1/orphans?q={needle}", headers=auth_headers)
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(item["id"] == created["id"] for item in items)


async def test_search_with_no_hits_returns_empty(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get(f"/api/v1/orphans?q=zzz-no-such-{uuid.uuid4().hex}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["total"] == 0
    assert r.json()["items"] == []
