"""GET /api/v1/countries/{code}/requirements — resolved config + auth.

The endpoint returns the resolved registration requirements for a country: a
seeded country (PS / EG) merges its row onto its profile, a valid-but-unconfigured
country (e.g. SA) falls back to the permissive baseline, and an unknown code
404s. It is authenticated and gated to the SAME roles that may register an orphan
(POST /orphans) — admins + the partner-scoped staff — so pure consumers and the
marketing/finance roles are 403'd and an anonymous call is 401.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``), which also runs the 0015
seed; otherwise they skip. They reuse the seeded DEV org + admin (``auth_headers``).
"""

from __future__ import annotations

from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import select

from app.core.database import make_session
from app.core.security import hash_password
from app.models.user import User
from app.scripts.seed import SEED_ADMIN_EMAIL

REQUIREMENTS_URL = "/api/v1/countries/{code}/requirements"


async def _seed_org_id() -> UUID:
    """The DEV org that ``auth_headers`` belongs to."""
    async with make_session() as db:
        admin = await db.scalar(select(User).where(User.email == SEED_ADMIN_EMAIL))
        assert admin is not None
        return admin.organization_id


async def _login_role(api: AsyncClient, role: str) -> dict[str, str]:
    """Create an active ``role`` user in the DEV org and return its auth headers.

    No جهة is assigned — country requirements are global config, so even a
    partner-scoped creator with no جهة may read them."""
    org_id = await _seed_org_id()
    suffix = uuid4().hex[:8]
    email = f"{role}-{suffix}@dev.example.com"
    password = "countryreqpw123456"
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


async def test_ps_resolves_conflict_profile(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """PS merges its seeded row onto the conflict profile."""
    r = await api.get(REQUIREMENTS_URL.format(code="PS"), headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["country_code"] == "PS"
    assert body["profile"] == "conflict"
    assert body["fields"] == {
        "show_conflict_fields": True,
        "requires_gps": False,
        "show_housing": False,
        "show_wash_fields": False,
    }
    assert body["national_id"] == {"required": False, "length": 9, "regex": None}
    assert body["phone"] == {"regex": "^(059|056)[0-9]{7}$"}
    assert body["required_documents"] == [
        "photo_id",
        "national_id",
        "birth_certificate",
        "death_certificate",
        "custody_declaration",
    ]


async def test_eg_resolves_documented_profile(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """EG merges its seeded row onto the documented profile (national id required,
    strict 14-digit regex, plus the inheritance_decree document)."""
    r = await api.get(REQUIREMENTS_URL.format(code="EG"), headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["country_code"] == "EG"
    assert body["profile"] == "documented"
    assert body["fields"] == {
        "show_conflict_fields": False,
        "requires_gps": False,
        "show_housing": True,
        "show_wash_fields": False,
    }
    assert body["national_id"] == {"required": True, "length": 14, "regex": "^[0-9]{14}$"}
    assert body["phone"] == {"regex": "^(010|011|012|015)[0-9]{8}$"}
    assert "inheritance_decree" in body["required_documents"]


async def test_valid_unconfigured_country_returns_baseline(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """SA is a real country with no country_requirements row → baseline, not 404."""
    r = await api.get(REQUIREMENTS_URL.format(code="SA"), headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["country_code"] == "SA"
    assert body["profile"] == "baseline"
    assert body["fields"] == {
        "show_conflict_fields": False,
        "requires_gps": False,
        "show_housing": False,
        "show_wash_fields": False,
    }
    assert body["national_id"] == {"required": False, "length": None, "regex": None}
    assert body["phone"] == {"regex": None}
    assert body["required_documents"] == []


async def test_code_is_case_insensitive(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A lowercase code normalizes to the canonical alpha-2 (ps → PS)."""
    r = await api.get(REQUIREMENTS_URL.format(code="ps"), headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["country_code"] == "PS"
    assert body["profile"] == "conflict"


async def test_unknown_country_is_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A code that is not a country at all 404s (the only 404 condition)."""
    r = await api.get(REQUIREMENTS_URL.format(code="ZZ"), headers=auth_headers)
    assert r.status_code == 404, r.text


async def test_requires_authentication(api: AsyncClient) -> None:
    """Not public: an anonymous request is rejected."""
    r = await api.get(REQUIREMENTS_URL.format(code="PS"))
    assert r.status_code == 401, r.text


async def test_partner_staff_creator_role_allowed(api: AsyncClient) -> None:
    """partner_staff may register an orphan, so it may read the config that drives
    that form — even with no جهة assigned (the config is global)."""
    headers = await _login_role(api, "partner_staff")
    r = await api.get(REQUIREMENTS_URL.format(code="EG"), headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["profile"] == "documented"


async def test_non_creator_roles_forbidden(api: AsyncClient) -> None:
    """Roles that cannot register an orphan are 403'd — pure consumers (donor /
    viewer) and the back-office marketing/finance roles alike."""
    for role in ("donor", "viewer", "marketing_manager", "finance"):
        headers = await _login_role(api, role)
        r = await api.get(REQUIREMENTS_URL.format(code="PS"), headers=headers)
        assert r.status_code == 403, f"{role}: expected 403, got {r.status_code}: {r.text}"
