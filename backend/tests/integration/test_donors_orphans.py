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


async def test_create_orphan_duplicate_returns_409(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The canonical idx_orphans_no_duplicate rule now surfaces as a clean 409
    on the staff create path (shared create helper), embedding the existing
    ORF code — not an unhandled 500."""
    import uuid

    partner_id = await _seed_partner_id()
    unique = uuid.uuid4().hex[:6]
    payload = {
        "first_name": f"Dup-{unique}",
        "family_name": "الكويتي",
        "date_of_birth": "2015-06-15",
        "gender": "M",
        "nationality": "KW",
        "father_name": f"محمد-{unique}",
        "partner_organization_id": partner_id,
    }
    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    existing_code = r.json()["code"]

    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 409, r.text
    assert existing_code in r.json()["detail"]


async def test_create_orphan_requires_father_name(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """father_name is a required domain field on the staff create path too."""
    import uuid

    partner_id = await _seed_partner_id()
    unique = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"NoFather-{unique}",
            "family_name": "x",
            "date_of_birth": "2015-06-15",
            "gender": "M",
            "nationality": "KW",
            "partner_organization_id": partner_id,
        },
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text
