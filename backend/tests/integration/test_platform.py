"""Integration tests for the super-admin platform API (B-6).

Covers cross-org org management, platform analytics, platform settings,
and — critically — that ONLY super_admin reaches any /platform/* or
/stats/platform/* endpoint (org_admin and every other role get 403).

Requires RUFAQAA_TEST_DATABASE_URL (see tests/integration/conftest.py).
Org codes / emails are randomised so the suite is re-runnable against a
persistent database.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.database import make_session
from app.core.security import hash_password
from app.models.donor import Donor
from app.models.organization import Organization
from app.models.payment import Payment
from app.models.user import User
from app.scripts.seed import SEED_ORG_CODE


def _rand(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


async def _dev_org_id() -> uuid.UUID:
    async with make_session() as db:
        org_id = await db.scalar(select(Organization.id).where(Organization.code == SEED_ORG_CODE))
        assert org_id is not None
        return org_id


async def _make_user(org_id: uuid.UUID, role: str) -> tuple[str, str]:
    """Create an active user with the given role; return (email, password)."""
    email = f"{_rand(role)}@test.rufaqaa.app"
    password = "TestPass12345"
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
    return email, password


async def _login(api: AsyncClient, email: str, password: str) -> dict[str, str]:
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
async def super_admin_headers(api: AsyncClient) -> dict[str, str]:
    org_id = await _dev_org_id()
    email, password = await _make_user(org_id, "super_admin")
    return await _login(api, email, password)


@pytest.fixture
async def finance_headers(api: AsyncClient) -> dict[str, str]:
    org_id = await _dev_org_id()
    email, password = await _make_user(org_id, "finance")
    return await _login(api, email, password)


async def _seed_org_donation(org_id: uuid.UUID, amount: Decimal, currency: str) -> None:
    """Insert one donor + one completed payment into an org so platform
    analytics have something to aggregate."""
    async with make_session() as db:
        donor = Donor(
            organization_id=org_id,
            code=_rand("DNR"),
            full_name="Test Donor",
            email=f"{_rand('donor')}@test.rufaqaa.app",
        )
        db.add(donor)
        await db.flush()
        db.add(
            Payment(
                organization_id=org_id,
                code=_rand("PAY"),
                donor_id=donor.id,
                amount=amount,
                currency=currency,
                amount_in_default_currency=amount,
                payment_method="credit_card",
                status="completed",
                completed_at=datetime.now(UTC),
            )
        )
        await db.commit()


# ── org management (super_admin happy paths) ─────────────────────────


async def test_super_admin_lists_orgs_across_boundaries(
    api: AsyncClient, super_admin_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/platform/organizations", headers=super_admin_headers)
    assert r.status_code == 200, r.text
    codes = {o["code"] for o in r.json()}
    # The seed creates both DEV and PLATFORM orgs — a single-tenant view
    # could never see both at once; the platform list does.
    assert {"DEV", "PLATFORM"}.issubset(codes)
    sample = r.json()[0]
    for key in ("total_orphans", "total_donors", "total_sponsorships", "status"):
        assert key in sample


async def test_list_orgs_sort_by_code_asc(
    api: AsyncClient, super_admin_headers: dict[str, str]
) -> None:
    """sort=code&order=asc orders the list by org code ascending. We seed three
    orgs whose codes differ only in a trailing uppercase letter (so the order is
    unambiguous under any DB collation) and assert their relative order in the
    response is A → M → Z even though they were created out of order."""
    tag = uuid.uuid4().hex[:6].upper()
    for suffix in ("M", "Z", "A"):
        r = await api.post(
            "/api/v1/platform/organizations",
            headers=super_admin_headers,
            json={
                "code": f"SORTZ{tag}{suffix}",
                "name_ar": "ترتيب",
                "name_en": "Sort",
                "country_code": "KW",
                "admin_email": f"{_rand('owner')}@test.rufaqaa.app",
                "admin_password": "OwnerPass12345",
            },
        )
        assert r.status_code == 201, r.text

    resp = await api.get(
        "/api/v1/platform/organizations?sort=code&order=asc", headers=super_admin_headers
    )
    assert resp.status_code == 200, resp.text
    ours = [o["code"] for o in resp.json() if o["code"].startswith(f"SORTZ{tag}")]
    assert ours == [f"SORTZ{tag}{s}" for s in ("A", "M", "Z")]


async def test_list_orgs_default_sort_is_created_at_desc(
    api: AsyncClient, super_admin_headers: dict[str, str]
) -> None:
    """With no sort param the list keeps the original newest-first ordering."""
    resp = await api.get("/api/v1/platform/organizations", headers=super_admin_headers)
    assert resp.status_code == 200, resp.text
    created = [datetime.fromisoformat(o["created_at"]) for o in resp.json()]
    assert created == sorted(created, reverse=True)


async def test_list_orgs_filter_by_plan(
    api: AsyncClient, super_admin_headers: dict[str, str]
) -> None:
    """plan=<value> returns only orgs carrying that exact subscription_plan."""
    create = await api.post(
        "/api/v1/platform/organizations",
        headers=super_admin_headers,
        json={
            "code": _rand("ORG"),
            "name_ar": "خطة",
            "name_en": "Plan Org",
            "country_code": "KW",
            "admin_email": f"{_rand('owner')}@test.rufaqaa.app",
            "admin_password": "OwnerPass12345",
        },
    )
    assert create.status_code == 201, create.text
    org_id = create.json()["organization"]["id"]
    plan = _rand("pl")  # unique, <= 20 chars (subscription_plan max_length)
    patch = await api.patch(
        f"/api/v1/platform/organizations/{org_id}",
        headers=super_admin_headers,
        json={"subscription_plan": plan},
    )
    assert patch.status_code == 200, patch.text

    resp = await api.get(f"/api/v1/platform/organizations?plan={plan}", headers=super_admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert any(o["id"] == org_id for o in body)
    assert all(o["subscription_plan"] == plan for o in body)


async def test_list_orgs_invalid_sort_or_order_rejected(
    api: AsyncClient, super_admin_headers: dict[str, str]
) -> None:
    """The sort/order whitelists are enforced by FastAPI → 422, not a 500."""
    bad_sort = await api.get(
        "/api/v1/platform/organizations?sort=not_a_column", headers=super_admin_headers
    )
    assert bad_sort.status_code == 422, bad_sort.text
    bad_order = await api.get(
        "/api/v1/platform/organizations?order=sideways", headers=super_admin_headers
    )
    assert bad_order.status_code == 422, bad_order.text


async def test_super_admin_create_get_patch_lifecycle(
    api: AsyncClient, super_admin_headers: dict[str, str]
) -> None:
    code = _rand("ORG")
    admin_email = f"{_rand('owner')}@test.rufaqaa.app"
    create = await api.post(
        "/api/v1/platform/organizations",
        headers=super_admin_headers,
        json={
            "code": code,
            "name_ar": "منظمة اختبار",
            "name_en": "Test Org",
            "country_code": "KW",
            "default_currency": "KWD",
            "org_type": "standalone",
            "deployment_mode": "self_hosted",
            "admin_email": admin_email,
            "admin_password": "OwnerPass12345",
        },
    )
    assert create.status_code == 201, create.text
    body = create.json()
    org_id = body["organization"]["id"]
    assert body["organization"]["code"] == code
    assert body["admin_user"]["email"] == admin_email

    # The provisioned org_admin must be able to authenticate.
    owner_headers = await _login(api, admin_email, "OwnerPass12345")
    assert owner_headers["Authorization"].startswith("Bearer ")

    # Detail
    detail = await api.get(f"/api/v1/platform/organizations/{org_id}", headers=super_admin_headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["org_type"] == "standalone"

    # Patch plan + expiry
    patch = await api.patch(
        f"/api/v1/platform/organizations/{org_id}",
        headers=super_admin_headers,
        json={"subscription_plan": "premium", "subscription_expires_at": "2030-01-01T00:00:00Z"},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["subscription_plan"] == "premium"

    # Suspend → status + reason recorded in settings
    susp = await api.post(
        f"/api/v1/platform/organizations/{org_id}/suspend",
        headers=super_admin_headers,
        json={"reason": "non-payment"},
    )
    assert susp.status_code == 200, susp.text
    assert susp.json()["status"] == "suspended"
    assert susp.json()["settings"]["suspension"]["reason"] == "non-payment"

    # Activate → status active + suspension cleared
    act = await api.post(
        f"/api/v1/platform/organizations/{org_id}/activate", headers=super_admin_headers
    )
    assert act.status_code == 200, act.text
    assert act.json()["status"] == "active"
    assert "suspension" not in act.json()["settings"]


async def test_create_org_conflicts(api: AsyncClient, super_admin_headers: dict[str, str]) -> None:
    code = _rand("ORG")
    email = f"{_rand('owner')}@test.rufaqaa.app"
    payload = {
        "code": code,
        "name_ar": "منظمة",
        "name_en": "Org",
        "country_code": "KW",
        "admin_email": email,
        "admin_password": "OwnerPass12345",
    }
    first = await api.post(
        "/api/v1/platform/organizations", headers=super_admin_headers, json=payload
    )
    assert first.status_code == 201, first.text

    # Duplicate code
    dup_code = await api.post(
        "/api/v1/platform/organizations",
        headers=super_admin_headers,
        json={**payload, "admin_email": f"{_rand('owner')}@test.rufaqaa.app"},
    )
    assert dup_code.status_code == 409

    # Duplicate admin email
    dup_email = await api.post(
        "/api/v1/platform/organizations",
        headers=super_admin_headers,
        json={**payload, "code": _rand("ORG")},
    )
    assert dup_email.status_code == 409


# ── platform analytics aggregate across orgs ─────────────────────────


async def test_platform_stats_aggregate_across_orgs(
    api: AsyncClient, super_admin_headers: dict[str, str]
) -> None:
    # New org with a known donation so we can assert it surfaces.
    create = await api.post(
        "/api/v1/platform/organizations",
        headers=super_admin_headers,
        json={
            "code": _rand("ORG"),
            "name_ar": "منظمة إحصاء",
            "name_en": "Stats Org",
            "country_code": "KW",
            "admin_email": f"{_rand('owner')}@test.rufaqaa.app",
            "admin_password": "OwnerPass12345",
        },
    )
    assert create.status_code == 201, create.text
    org_id = uuid.UUID(create.json()["organization"]["id"])
    await _seed_org_donation(org_id, Decimal("123.45"), "USD")

    summary = await api.get("/api/v1/stats/platform/summary", headers=super_admin_headers)
    assert summary.status_code == 200, summary.text
    s = summary.json()
    assert s["total_orgs"] >= 3  # DEV + PLATFORM + at least our new org
    assert s["active_orgs"] >= 1
    # The USD donation we just inserted must be represented.
    usd = [c for c in s["total_donated_by_currency"] if c["currency"] == "USD"]
    assert usd and Decimal(usd[0]["total"]) >= Decimal("123.45")
    assert Decimal(s["total_donated_converted"]) >= Decimal("123.45")

    by_org = await api.get("/api/v1/stats/platform/by-org?limit=100", headers=super_admin_headers)
    assert by_org.status_code == 200, by_org.text
    ours = [o for o in by_org.json()["items"] if o["organization_id"] == str(org_id)]
    assert ours and Decimal(ours[0]["donations_total"]) == Decimal("123.45")

    ts = await api.get("/api/v1/stats/platform/timeseries", headers=super_admin_headers)
    assert ts.status_code == 200, ts.text
    assert "months" in ts.json()


async def test_platform_headline_funnel_payment_methods(
    api: AsyncClient, super_admin_headers: dict[str, str]
) -> None:
    """The three analytics-gap endpoints return 200 with the documented
    shape for super_admin. We seed a donor + completed credit_card payment
    so the donor and payment-method aggregates have something to surface."""
    org_id = await _dev_org_id()
    await _seed_org_donation(org_id, Decimal("75.50"), "KWD")

    # Headline: avg sponsorship duration (whole days or null) + donor
    # activation rate (in-platform, 0..1 — NOT visitor→donor).
    headline = await api.get("/api/v1/stats/platform/headline", headers=super_admin_headers)
    assert headline.status_code == 200, headline.text
    h = headline.json()
    assert set(h) == {"avg_sponsorship_duration_days", "donor_conversion_rate"}
    assert h["avg_sponsorship_duration_days"] is None or isinstance(
        h["avg_sponsorship_duration_days"], int
    )
    assert isinstance(h["donor_conversion_rate"], int | float)
    assert 0.0 <= h["donor_conversion_rate"] <= 1.0

    # Funnel: registered → sponsored → active, each a plain count.
    funnel = await api.get("/api/v1/stats/platform/funnel", headers=super_admin_headers)
    assert funnel.status_code == 200, funnel.text
    f = funnel.json()
    assert set(f) == {
        "registered_donors",
        "donors_with_sponsorship",
        "donors_with_active_sponsorship",
    }
    assert all(isinstance(v, int) for v in f.values())
    assert f["registered_donors"] >= 1  # the donor we just seeded
    # Active sponsors are a subset of donors who ever created a sponsorship.
    assert f["donors_with_active_sponsorship"] <= f["donors_with_sponsorship"]

    # Payment methods: one slice per completed-payment method.
    methods = await api.get("/api/v1/stats/platform/payment-methods", headers=super_admin_headers)
    assert methods.status_code == 200, methods.text
    m = methods.json()
    assert "items" in m
    for item in m["items"]:
        assert set(item) == {"method", "count", "total"}
    cc = [it for it in m["items"] if it["method"] == "credit_card"]
    assert cc, "the seeded completed credit_card payment must appear"
    assert cc[0]["count"] >= 1
    assert Decimal(cc[0]["total"]) >= Decimal("75.50")


# ── platform settings ────────────────────────────────────────────────


async def test_platform_settings_get_and_patch(
    api: AsyncClient, super_admin_headers: dict[str, str]
) -> None:
    get1 = await api.get("/api/v1/platform/settings", headers=super_admin_headers)
    assert get1.status_code == 200, get1.text
    assert "settings" in get1.json()

    patch = await api.patch(
        "/api/v1/platform/settings",
        headers=super_admin_headers,
        json={"settings": {"maintenance_mode": True, "signups_open": False}},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["settings"]["maintenance_mode"] is True
    assert patch.json()["settings"]["signups_open"] is False

    # Persisted + shallow-merge keeps prior keys.
    patch2 = await api.patch(
        "/api/v1/platform/settings",
        headers=super_admin_headers,
        json={"settings": {"default_subscription_plan": "free"}},
    )
    assert patch2.status_code == 200, patch2.text
    merged = patch2.json()["settings"]
    assert merged["default_subscription_plan"] == "free"
    assert merged["maintenance_mode"] is True  # retained from earlier patch


# ── authorization: only super_admin gets in ──────────────────────────


# Every platform / platform-stats route, as (method, path, json-body).
_PLATFORM_ROUTES = [
    ("get", "/api/v1/platform/organizations", None),
    (
        "post",
        "/api/v1/platform/organizations",
        {
            "code": "X",
            "name_ar": "x",
            "name_en": "x",
            "country_code": "KW",
            "admin_email": "x@x.com",
            "admin_password": "Pass12345",
        },
    ),
    ("get", f"/api/v1/platform/organizations/{uuid.uuid4()}", None),
    ("patch", f"/api/v1/platform/organizations/{uuid.uuid4()}", {"subscription_plan": "free"}),
    ("post", f"/api/v1/platform/organizations/{uuid.uuid4()}/suspend", {"reason": "x"}),
    ("post", f"/api/v1/platform/organizations/{uuid.uuid4()}/activate", None),
    ("get", "/api/v1/platform/settings", None),
    ("patch", "/api/v1/platform/settings", {"settings": {}}),
    ("get", "/api/v1/stats/platform/summary", None),
    ("get", "/api/v1/stats/platform/timeseries", None),
    ("get", "/api/v1/stats/platform/by-org", None),
    ("get", "/api/v1/stats/platform/headline", None),
    ("get", "/api/v1/stats/platform/funnel", None),
    ("get", "/api/v1/stats/platform/payment-methods", None),
]


async def _call(api: AsyncClient, method: str, path: str, body, headers):  # noqa: ANN001
    return await api.request(method.upper(), path, json=body, headers=headers)


async def test_org_admin_forbidden_on_all_platform_routes(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The seeded admin is org_admin — part of ADMIN_ROLES, but per-org.
    It must be 403 on EVERY platform endpoint, never leak cross-org."""
    for method, path, body in _PLATFORM_ROUTES:
        r = await _call(api, method, path, body, auth_headers)
        assert r.status_code == 403, f"{method} {path} -> {r.status_code} (expected 403)"


async def test_finance_role_forbidden_on_all_platform_routes(
    api: AsyncClient, finance_headers: dict[str, str]
) -> None:
    for method, path, body in _PLATFORM_ROUTES:
        r = await _call(api, method, path, body, finance_headers)
        assert r.status_code == 403, f"{method} {path} -> {r.status_code} (expected 403)"


async def test_unauthenticated_rejected_on_platform_routes(api: AsyncClient) -> None:
    for method, path, body in _PLATFORM_ROUTES:
        r = await _call(api, method, path, body, {})
        assert r.status_code == 401, f"{method} {path} -> {r.status_code} (expected 401)"
