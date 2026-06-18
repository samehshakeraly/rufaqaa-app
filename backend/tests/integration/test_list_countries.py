"""GET /api/v1/countries — the active-country list for the registration dropdown.

The endpoint returns every ``is_active`` country as ``{code, name_ar, name_en}``
ordered by English name; inactive countries are omitted. It is authenticated and
gated to the SAME roles that may register an orphan (POST /orphans) — admins +
the partner-scoped staff — so pure consumers and the marketing/finance roles are
403'd and an anonymous call is 401.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``), which also loads the schema's
country seed; otherwise they skip. They reuse the seeded DEV org + admin
(``auth_headers``).
"""

from __future__ import annotations

from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import select, text

from app.core.database import make_session
from app.core.security import hash_password
from app.models.user import User
from app.scripts.seed import SEED_ADMIN_EMAIL

COUNTRIES_URL = "/api/v1/countries"


async def _seed_org_id() -> UUID:
    """The DEV org that ``auth_headers`` belongs to."""
    async with make_session() as db:
        admin = await db.scalar(select(User).where(User.email == SEED_ADMIN_EMAIL))
        assert admin is not None
        return admin.organization_id


async def _login_role(api: AsyncClient, role: str) -> dict[str, str]:
    """Create an active ``role`` user in the DEV org and return its auth headers."""
    org_id = await _seed_org_id()
    suffix = uuid4().hex[:8]
    email = f"{role}-{suffix}@dev.example.com"
    password = "listcountriespw123456"
    async with make_session() as db:
        db.add(
            User(
                organization_id=org_id,
                email=email,
                password_hash=hash_password(password),
                first_name="Test",
                last_name=role,
                role=role,
                status="active",
            )
        )
        await db.commit()
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_lists_active_countries(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Each item is exactly {code, name_ar, name_en}, a seeded active country is
    present, and the list is ordered alphabetically by English name."""
    r = await api.get(COUNTRIES_URL, headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list) and body, "expected a non-empty list"
    # Exactly the three dropdown fields — no extra country columns leaked.
    for item in body:
        assert set(item) == {"code", "name_ar", "name_en"}
    by_code = {c["code"]: c for c in body}
    # EG is seeded active by the canonical schema.
    assert by_code["EG"] == {"code": "EG", "name_ar": "مصر", "name_en": "Egypt"}
    # The dropdown relies on alphabetical-by-English-name order.
    names = [c["name_en"] for c in body]
    assert names == sorted(names, key=str.lower)


async def test_excludes_inactive_country(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A country with is_active = false never appears in the dropdown list."""
    a2, a3 = "XB", "XBT"
    async with make_session() as db:
        await db.execute(
            text(
                "INSERT INTO countries (code_alpha2, code_alpha3, name_ar, name_en, is_active) "
                "VALUES (:a2, :a3, :ar, :en, false)"
            ),
            {"a2": a2, "a3": a3, "ar": "بلد غير نشط", "en": "Inactive Testland"},
        )
        await db.commit()
    try:
        r = await api.get(COUNTRIES_URL, headers=auth_headers)
        assert r.status_code == 200, r.text
        codes = {c["code"] for c in r.json()}
        assert a2 not in codes, "inactive country must be excluded"
    finally:
        # Keep the shared test DB idempotent across re-runs.
        async with make_session() as db:
            await db.execute(text("DELETE FROM countries WHERE code_alpha2 = :a2"), {"a2": a2})
            await db.commit()


async def test_requires_authentication(api: AsyncClient) -> None:
    """Not public: an anonymous request is rejected."""
    r = await api.get(COUNTRIES_URL)
    assert r.status_code == 401, r.text


async def test_non_creator_role_forbidden(api: AsyncClient) -> None:
    """A role that cannot register an orphan (donor) is 403'd."""
    headers = await _login_role(api, "donor")
    r = await api.get(COUNTRIES_URL, headers=headers)
    assert r.status_code == 403, r.text


async def test_partner_staff_creator_role_allowed(api: AsyncClient) -> None:
    """partner_staff may register an orphan, so it may read the dropdown list."""
    headers = await _login_role(api, "partner_staff")
    r = await api.get(COUNTRIES_URL, headers=headers)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)
