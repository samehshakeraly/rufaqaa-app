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
        assert row is not None, "seed partner missing — run app.scripts.seed"
        return row[0]


async def test_create_and_list_donor(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    import uuid

    payload = {
        "full_name": "محسن خيّر",
        "email": f"donor-{uuid.uuid4().hex[:8]}@example.com",
        "preferred_currency": "KWD",
        "country_of_residence": "KW",
    }
    r = await api.post("/api/v1/donors", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["code"].startswith("DON-")
    assert created["email"] == payload["email"]

    r = await api.get("/api/v1/donors?limit=5", headers=auth_headers)
    assert r.status_code == 200
    page = r.json()
    assert page["total"] >= 1
    assert any(d["id"] == created["id"] for d in page["items"])

    r = await api.get(f"/api/v1/donors/{created['id']}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


async def test_create_orphan_requires_partner(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    import uuid

    partner_id = await _seed_partner_id()
    unique = uuid.uuid4().hex[:6]
    payload = {
        "first_name": f"أحمد-{unique}",
        "family_name": "الكويتي",
        "date_of_birth": "2015-06-15",
        "gender": "M",
        "nationality": "KW",
        "father_name": f"محمد الكويتي-{unique}",
        "partner_organization_id": partner_id,
    }
    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["code"].startswith("ORF-")
    assert created["case_status"] == "pending_review"

    r = await api.get(f"/api/v1/orphans/{created['id']}", headers=auth_headers)
    assert r.status_code == 200
