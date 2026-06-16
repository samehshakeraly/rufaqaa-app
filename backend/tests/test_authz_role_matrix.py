"""Authorization role-gate matrix.

Regression coverage for the least-privilege ``require_roles`` gates added in
``fix/authz-role-gate-coverage``. Each newly-gated staff / finance / marketing /
admin endpoint must reject a principal whose role sits outside its grouping —
``donor`` and ``guardian`` are the canonical "any authenticated user" callers
the audit was closing — while still admitting a staff principal.

The matrix runs WITHOUT a database. ``get_current_user`` is overridden to mint a
detached principal of the role under test, and ``get_db`` is stubbed with a
session that raises on first use. So a request that clears the gate fails
*inside the handler* (surfacing as a 500), and the only way to observe a 403 is
the gate itself — which isolates exactly what we assert: the gate, not the
handler body or the tenant-scoping query.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.main import app
from app.models.user import User

# Fixed UUID for path params. Existence is irrelevant: a blocked role is
# rejected by the gate before any lookup, and an admitted role trips the stubbed
# DB regardless of the id.
_OID = "00000000-0000-0000-0000-0000000000aa"


@pytest.fixture(autouse=True)
def _no_rate_limit() -> Iterator[None]:
    # The matrix fires many requests as a single caller; the limiter would turn
    # later ones into 429s and mask the 403 / handler outcomes we assert on.
    original = settings.RATE_LIMIT_ENABLED
    settings.RATE_LIMIT_ENABLED = False
    try:
        yield
    finally:
        settings.RATE_LIMIT_ENABLED = original


class _UnusableSession:
    """DB stand-in. The role gate never touches the session, so any attribute
    access means a handler ran *past* the gate; raising here keeps the matrix
    hermetic and turns a cleared gate into a 500 rather than a real query."""

    def __getattr__(self, name: str) -> Any:
        raise RuntimeError(f"DB access ({name!r}) is disabled in the authz matrix")


async def _stub_db() -> AsyncIterator[Any]:
    yield _UnusableSession()


@pytest.fixture(autouse=True)
def _stub_database() -> Iterator[None]:
    app.dependency_overrides[get_db] = _stub_db
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_db, None)


def _principal(role: str) -> User:
    """A detached User carrying just enough for ``require_roles`` to decide."""
    return User(
        id=uuid4(),
        organization_id=uuid4(),
        partner_organization_id=None,
        email="matrix@example.test",
        role=role,
        status="active",
        email_verified_at=None,
    )


async def _status_for(role: str, method: str, path: str) -> int:
    app.dependency_overrides[get_current_user] = lambda: _principal(role)
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.request(method, path, json={} if method == "POST" else None)
            return resp.status_code
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# A representative slice of the newly-gated endpoints — at least one per router
# and per role grouping (FINANCE / STAFF / MARKETING / ADMIN).
NEWLY_GATED: list[tuple[str, str]] = [
    # FINANCE_ROLES — donors / payments / sponsorships
    ("GET", "/api/v1/donors"),
    ("GET", f"/api/v1/donors/{_OID}"),
    ("GET", "/api/v1/donors/export.csv"),
    ("POST", "/api/v1/payments"),
    ("GET", f"/api/v1/payments/{_OID}/receipt"),
    ("GET", "/api/v1/payments/export.csv"),
    ("POST", "/api/v1/sponsorships"),
    ("GET", f"/api/v1/sponsorships/{_OID}"),
    ("GET", "/api/v1/sponsorships/export.csv"),
    # STAFF_ROLES — families / orphanages / orphans / media / partners /
    # organization / stats
    ("GET", "/api/v1/families"),
    ("GET", f"/api/v1/families/{_OID}"),
    ("GET", "/api/v1/orphanages"),
    ("GET", f"/api/v1/orphanages/{_OID}"),
    ("GET", "/api/v1/orphans"),
    ("GET", "/api/v1/orphans/export.csv"),
    ("GET", f"/api/v1/orphans/{_OID}"),
    ("GET", f"/api/v1/orphans/{_OID}/timeline"),
    ("GET", f"/api/v1/media/orphans/{_OID}/photos"),
    ("GET", f"/api/v1/media/{_OID}/url"),
    ("GET", f"/api/v1/partners/{_OID}"),
    ("GET", f"/api/v1/partners/{_OID}/stats"),
    ("GET", "/api/v1/organization"),
    ("GET", "/api/v1/stats/summary"),
    ("GET", "/api/v1/stats/payments-timeseries"),
    ("GET", "/api/v1/stats/sponsorships-by-status"),
    ("GET", "/api/v1/stats/donations-by-partner"),
    ("GET", "/api/v1/reports"),
    # MARKETING_ROLES — marketing channels
    ("GET", "/api/v1/marketing-channels"),
    ("GET", f"/api/v1/marketing-channels/{_OID}"),
    # ADMIN_ROLES — audit
    ("GET", "/api/v1/audit"),
]


@pytest.mark.parametrize(("method", "path"), NEWLY_GATED)
@pytest.mark.parametrize("role", ["donor", "guardian"])
async def test_consumer_roles_are_forbidden(role: str, method: str, path: str) -> None:
    """A donor or guardian principal is rejected by every newly-gated endpoint."""
    status = await _status_for(role, method, path)
    assert status == 403, f"{role} expected 403 on {method} {path}, got {status}"


@pytest.mark.parametrize(("method", "path"), NEWLY_GATED)
async def test_org_admin_clears_every_gate(method: str, path: str) -> None:
    """org_admin is in ADMIN_ROLES — a subset of FINANCE / MARKETING / STAFF —
    so it clears all of them. Past the gate the stubbed DB trips a 500 (or a 422
    for a body-less POST); the assertion is only that it is NOT a 403."""
    status = await _status_for("org_admin", method, path)
    assert status != 403, f"org_admin should clear the gate on {method} {path}, got {status}"


# Least-privilege spot checks: a staff role OUTSIDE an endpoint's grouping is
# still rejected, while a role INSIDE it clears the gate.
# (role, method, path, expected_forbidden)
LEAST_PRIVILEGE: list[tuple[str, str, str, bool]] = [
    ("marketing_manager", "GET", "/api/v1/donors", True),  # FINANCE only
    ("partner_staff", "GET", "/api/v1/donors", True),  # FINANCE only
    ("finance", "GET", "/api/v1/audit", True),  # ADMIN only
    ("partner_staff", "GET", "/api/v1/audit", True),  # ADMIN only
    ("finance", "GET", "/api/v1/marketing-channels", True),  # MARKETING only
    ("finance", "GET", "/api/v1/donors", False),  # FINANCE includes finance
    ("finance", "GET", "/api/v1/families", False),  # STAFF includes finance
    ("partner_staff", "GET", f"/api/v1/partners/{_OID}", False),  # STAFF includes partner_staff
    ("marketing_manager", "GET", "/api/v1/marketing-channels", False),  # MARKETING
]


@pytest.mark.parametrize(("role", "method", "path", "expected_forbidden"), LEAST_PRIVILEGE)
async def test_least_privilege_boundaries(
    role: str, method: str, path: str, expected_forbidden: bool
) -> None:
    status = await _status_for(role, method, path)
    if expected_forbidden:
        assert status == 403, f"{role} expected 403 on {method} {path}, got {status}"
    else:
        assert status != 403, f"{role} should clear the gate on {method} {path}, got {status}"
