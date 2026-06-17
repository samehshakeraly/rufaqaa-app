"""DB-free role matrix for the least-privilege staff/admin gates (B2).

Background
----------
``get_current_user`` authenticates a request and checks ``status == 'active'`` —
it does NOT check role. Least-privilege authorization is layered on top by the
``require_roles`` dependency. Before this pass, 42 staff/admin endpoints accepted
*any* authenticated user (donor / guardian / orphan / viewer) because they used a
bare ``CurrentUser`` with no role gate. Tenant isolation already held
(``get_in_org_or_404`` / explicit ``organization_id`` filters), so the exposure
was *within-tenant* privilege escalation, not cross-tenant leakage — a donor in
org A reaching org A's finance/staff surfaces.

This module pins those gates so they cannot silently regress. It is entirely
DB-free:

* it inspects the live FastAPI app's dependency graph to recover each endpoint's
  ``require_roles`` allow-set (the wiring), and
* it exercises the recovered gate function directly with in-memory principals
  (the behaviour).

Nothing here opens a session, hits Postgres, or spins up the ASGI transport — the
gate is a pure function of ``user.role``, so the matrix is pure too.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from app.api.v1 import (
    audit,
    donors,
    families,
    marketing_channels,
    media,
    organization,
    orphanages,
    orphans,
    partners,
    payments,
    reports,
    sponsorships,
    stats,
)
from app.core.authz import ADMIN_ROLES, FINANCE_ROLES, MARKETING_ROLES, STAFF_ROLES

API_PREFIX = "/api/v1"

# Sub-router → mount prefix. Mirrors app/api/v1/__init__.py; only the routers
# touched by the B2 pass are listed. Full paths are reconstructed from these so
# the matrix reads in real URL terms while staying independent of FastAPI's
# (version-specific) app-level route nesting — each plain APIRouter still
# exposes its own ``.routes`` with a populated ``.dependant``.
_MOUNTS: tuple[tuple[str, Any], ...] = (
    ("/donors", donors.router),
    ("/payments", payments.router),
    ("/sponsorships", sponsorships.router),
    ("/families", families.router),
    ("/orphanages", orphanages.router),
    ("/orphans", orphans.router),
    ("/media", media.router),
    ("/partners", partners.router),
    ("/organization", organization.router),
    ("/stats", stats.router),
    ("/reports", reports.router),
    ("/marketing-channels", marketing_channels.router),
    ("/audit", audit.router),
)

# ── Role groups under test (frozen copies of the authz groupings) ───────────
FINANCE = frozenset(FINANCE_ROLES)
STAFF = frozenset(STAFF_ROLES)
MARKETING = frozenset(MARKETING_ROLES)
ADMIN = frozenset(ADMIN_ROLES)

# Pure data-consumer roles. None of these may reach a staff/admin endpoint —
# this is the property the whole pass exists to guarantee. ``viewer`` /
# ``orphan`` are reserved roles today; they are included so a future activation
# inherits the deny-by-default posture.
CONSUMER_ROLES = ("donor", "guardian", "orphan", "viewer")


class _Principal:
    """Minimal stand-in for ``app.models.user.User``.

    The ``require_roles`` checker only reads ``.role``; using a tiny object
    keeps the matrix DB-free (no ORM instance, no session, no identity map).
    """

    def __init__(self, role: str) -> None:
        self.role = role
        self.email_verified_at = None
        self.status = "active"


# ── Dependency-graph introspection ──────────────────────────────────────────


def _iter_dependants(dep: Dependant) -> Iterator[Dependant]:
    """Yield ``dep`` and every transitive sub-dependency."""
    yield dep
    for sub in dep.dependencies:
        yield from _iter_dependants(sub)


def _require_roles_allowed(call: Any) -> frozenset[str] | None:
    """Recover the allow-set captured by a ``require_roles`` checker closure.

    ``require_roles`` builds ``allowed_set = set(allowed)`` and closes a nested
    ``_checker`` over it; the set is therefore a free variable on the returned
    function. Any other callable (plain endpoint, ``get_current_user``,
    ``require_verified_donor`` — which closes over nothing) returns ``None``,
    which is how this distinguishes a role gate from every other dependency.
    """
    code = getattr(call, "__code__", None)
    closure = getattr(call, "__closure__", None)
    if code is None or closure is None or "allowed_set" not in code.co_freevars:
        return None
    cell = closure[code.co_freevars.index("allowed_set")]
    value = cell.cell_contents
    if not isinstance(value, set):
        return None
    return frozenset(value)


def _gate_checker(route: APIRoute) -> Any | None:
    """The ``require_roles`` ``_checker`` wired onto ``route``, or ``None``."""
    for dep in _iter_dependants(route.dependant):
        if dep.call is not None and _require_roles_allowed(dep.call) is not None:
            return dep.call
    return None


def _collect_gates() -> tuple[dict[tuple[str, str], frozenset[str]], dict[tuple[str, str], Any]]:
    """Walk every B2 sub-router and recover its role gates.

    Returns ``(allowed_by, checker_by)`` keyed by ``(METHOD, full-path)``: the
    allow-set (for the wiring assertions) and the live ``_checker`` (for the
    behavioural ones). Full paths are ``/api/v1`` + mount prefix + route path.
    """
    allowed_by: dict[tuple[str, str], frozenset[str]] = {}
    checker_by: dict[tuple[str, str], Any] = {}
    for prefix, router in _MOUNTS:
        for route in router.routes:
            if not isinstance(route, APIRoute):
                continue
            checker = _gate_checker(route)
            if checker is None:
                continue
            allowed = _require_roles_allowed(checker)
            assert allowed is not None  # narrowed by _gate_checker
            full = f"{API_PREFIX}{prefix}{route.path}"
            for method in route.methods - {"HEAD", "OPTIONS"}:
                allowed_by[(method, full)] = allowed
                checker_by[(method, full)] = checker
    return allowed_by, checker_by


def _checker_for(method: str, path: str) -> Any:
    checker = _CHECKERS.get((method, path))
    assert checker is not None, f"{method} {path} has no require_roles gate"
    return checker


async def _admits(checker: Any, role: str) -> bool:
    """True iff ``role`` clears ``checker``.

    Awaits the gate directly with an in-memory principal. The checker performs
    no I/O (it only reads ``user.role``), so this stays DB-free — there is no
    session, request, or transport involved.
    """
    try:
        return (await checker(_Principal(role))) is not None
    except HTTPException as exc:
        assert exc.status_code == 403, exc.status_code
        return False


APP_GATES, _CHECKERS = _collect_gates()


# ── The B2 least-privilege table (endpoint → expected allow-set) ────────────
#
# This is the regression pin: the exact gate every endpoint closed in this pass
# must carry. Equality is checked (not subset), so both a dropped gate and a
# *widened* one fail here.
EXPECTED_GATES: dict[tuple[str, str], frozenset[str]] = {
    # ── FINANCE: donor records + money movement ──────────────────────────
    ("GET", "/api/v1/donors"): FINANCE,
    ("GET", "/api/v1/donors/export.csv"): FINANCE,
    ("POST", "/api/v1/donors"): FINANCE,
    ("GET", "/api/v1/donors/{donor_id}"): FINANCE,
    ("PATCH", "/api/v1/donors/{donor_id}"): FINANCE,
    ("POST", "/api/v1/payments"): FINANCE,
    ("GET", "/api/v1/payments/{payment_id}/receipt"): FINANCE,
    ("GET", "/api/v1/payments/export.csv"): FINANCE,
    ("POST", "/api/v1/sponsorships"): FINANCE,
    ("GET", "/api/v1/sponsorships/export.csv"): FINANCE,
    ("GET", "/api/v1/sponsorships/{sponsorship_id}"): FINANCE,
    ("PATCH", "/api/v1/sponsorships/{sponsorship_id}"): FINANCE,
    ("POST", "/api/v1/sponsorships/{sponsorship_id}/pause"): FINANCE,
    ("POST", "/api/v1/sponsorships/{sponsorship_id}/resume"): FINANCE,
    ("POST", "/api/v1/sponsorships/{sponsorship_id}/cancel"): FINANCE,
    # ── STAFF: case-management surfaces (partner roles scoped further) ────
    ("GET", "/api/v1/families"): STAFF,
    ("POST", "/api/v1/families"): STAFF,
    ("GET", "/api/v1/families/{family_id}"): STAFF,
    ("GET", "/api/v1/families/{family_id}/guardians"): STAFF,
    ("POST", "/api/v1/families/{family_id}/guardians"): STAFF,
    ("GET", "/api/v1/orphanages"): STAFF,
    ("POST", "/api/v1/orphanages"): STAFF,
    ("GET", "/api/v1/orphanages/{orphanage_id}"): STAFF,
    ("PATCH", "/api/v1/orphanages/{orphanage_id}"): STAFF,
    ("GET", "/api/v1/orphans"): STAFF,
    ("GET", "/api/v1/orphans/export.csv"): STAFF,
    ("GET", "/api/v1/orphans/{orphan_id}"): STAFF,
    ("PATCH", "/api/v1/orphans/{orphan_id}"): STAFF,
    ("GET", "/api/v1/orphans/{orphan_id}/timeline"): STAFF,
    ("GET", "/api/v1/media/orphans/{orphan_id}/photos"): STAFF,
    ("GET", "/api/v1/media/{media_id}/url"): STAFF,
    ("GET", "/api/v1/partners/{partner_id}"): STAFF,
    ("GET", "/api/v1/partners/{partner_id}/stats"): STAFF,
    ("GET", "/api/v1/organization"): STAFF,
    ("GET", "/api/v1/stats/summary"): STAFF,
    ("GET", "/api/v1/stats/payments-timeseries"): STAFF,
    ("GET", "/api/v1/stats/sponsorships-by-status"): STAFF,
    ("GET", "/api/v1/stats/donations-by-partner"): STAFF,
    ("GET", "/api/v1/reports"): STAFF,
    # ── MARKETING: acquisition-channel reads ─────────────────────────────
    ("GET", "/api/v1/marketing-channels"): MARKETING,
    ("GET", "/api/v1/marketing-channels/{channel_id}"): MARKETING,
    # ── ADMIN: the audit trail ───────────────────────────────────────────
    ("GET", "/api/v1/audit"): ADMIN,
}


# ── Tests ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("method", "path"), list(EXPECTED_GATES), ids=lambda v: v if isinstance(v, str) else None
)
def test_b2_gate_wiring(method: str, path: str) -> None:
    """Each B2 endpoint carries exactly its expected least-privilege gate.

    Equality (not subset) so a dropped gate (endpoint missing from the app's
    gate map) and a widened one (extra role) both fail.
    """
    expected = EXPECTED_GATES[(method, path)]
    assert (method, path) in APP_GATES, f"{method} {path} has no require_roles gate"
    assert APP_GATES[(method, path)] == expected


@pytest.mark.parametrize(
    ("method", "path"), list(EXPECTED_GATES), ids=lambda v: v if isinstance(v, str) else None
)
async def test_b2_endpoint_role_behavior(method: str, path: str) -> None:
    """Behavioural check per endpoint: data-consumer roles get 403; the
    administrator roles (``org_admin`` per-tenant, ``super_admin`` platform)
    always clear the gate."""
    checker = _checker_for(method, path)
    for role in CONSUMER_ROLES:
        assert not await _admits(checker, role), f"{role} must be 403 on {method} {path}"
    assert await _admits(checker, "org_admin"), f"org_admin must clear {method} {path}"
    assert await _admits(checker, "super_admin"), f"super_admin must clear {method} {path}"


# Least-privilege boundaries: the cases where one staff role must NOT inherit
# another's surface. (role, gate, expected-allowed).
_BOUNDARIES: list[tuple[str, frozenset[str], bool]] = [
    ("finance", FINANCE, True),
    ("finance", STAFF, True),  # finance is part of the staff surface
    ("finance", MARKETING, False),
    ("finance", ADMIN, False),
    ("marketing_manager", MARKETING, True),
    ("marketing_manager", STAFF, True),
    ("marketing_manager", FINANCE, False),
    ("marketing_manager", ADMIN, False),
    ("partner_manager", STAFF, True),
    ("partner_manager", FINANCE, False),
    ("partner_staff", STAFF, True),
    ("partner_staff", ADMIN, False),
    ("org_admin", ADMIN, True),
    ("super_admin", ADMIN, True),
]


@pytest.mark.parametrize(("role", "gate", "expected"), _BOUNDARIES)
async def test_least_privilege_boundaries(role: str, gate: frozenset[str], expected: bool) -> None:
    """A role clears a gate iff it is in the group (or is ``super_admin``).

    Exercises the real ``require_roles`` checker pulled off a live route that
    uses ``gate``, so the boundary is verified against production wiring rather
    than a re-implementation of the rule.
    """
    method, path = next(mp for mp, allowed in EXPECTED_GATES.items() if allowed == gate)
    checker = _checker_for(method, path)
    assert await _admits(checker, role) is expected


def test_matrix_is_complete_and_least_privilege() -> None:
    """Meta-guard on the table itself.

    * the B2 table describes exactly 42 endpoints;
    * every one is actually wired in the app (catches a path typo / rename);
    * no data-consumer role appears in ANY B2 allow-set — the single property
      the whole pass guarantees.
    """
    assert len(EXPECTED_GATES) == 42, len(EXPECTED_GATES)
    missing = [mp for mp in EXPECTED_GATES if mp not in APP_GATES]
    assert not missing, f"declared but not wired: {missing}"
    for (method, path), allowed in EXPECTED_GATES.items():
        leaked = set(CONSUMER_ROLES) & allowed
        assert not leaked, f"{method} {path} leaks consumer role(s) {leaked}"
