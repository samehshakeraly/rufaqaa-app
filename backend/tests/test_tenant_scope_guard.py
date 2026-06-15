"""Structural guard against cross-tenant data leaks (Phase 5 regression guard).

PRs #99–#103 closed a class of multi-tenant isolation bugs: endpoints that
queried tenant-owned tables without filtering by ``organization_id``. The app
connects to Postgres as a SUPERUSER, which BYPASSES Row-Level Security, so every
query over tenant-owned data must scope to the caller's org EXPLICITLY in code —
RLS will not save us. A forgotten filter leaks (or reveals the existence of)
another organization's rows.

This module is a STATIC guard so that class cannot silently come back. It parses
every router under ``app/api/v1/`` with :mod:`ast` — it never imports or runs the
app — and fails if an *endpoint* function builds a query over a tenant-owned
model without any recognised org-scoping signal:

* an explicit ``<Model>.organization_id == ...`` comparison (a WHERE filter),
* a call to :func:`app.api.scoping.get_in_org_or_404`,
* constructing the tenant row with ``organization_id=...`` — create endpoints
  anchor the new row to the caller's org (no foreign fetch), or
* delegation to a same-file helper that itself carries one of the above. Helper
  calls are flattened into the endpoint's reachable closure, so the parent-fetch
  pattern (fetch the org-checked parent via the helper, then read its children
  by FK) is recognised as scoped.

The heuristic is deliberately pragmatic — it aims to catch a forgotten org
filter on a new list / export / by-id endpoint, not to be a perfect analyzer —
and it FAILS CLOSED: a tenant query it cannot prove is scoped is reported,
forcing the author to either scope it or add it to the allowlist below with a
one-line reason.

Intentional exceptions are kept in the EXPLICIT, COMMENTED allowlist near the
top of this file.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field
from pathlib import Path

# ── Locations ──────────────────────────────────────────────────────────────
# tests/  ->  backend/  ->  app/api/v1 and app/models
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_V1_DIR = _BACKEND_ROOT / "app" / "api" / "v1"
_MODELS_DIR = _BACKEND_ROOT / "app" / "models"


# ── Allowlist (intentional exceptions) ─────────────────────────────────────
#
# Whole files where org-scoping does not apply because the surface is public,
# self/principal-scoped, pre-auth, or deliberately cross-org (super_admin).
_EXEMPT_FILES: dict[str, str] = {
    "auth.py": "login / signup / refresh — pre-org credential flows, no caller org yet",
    "public.py": "deliberately public read surface (donor browsing), no authenticated org",
    "webhooks.py": "payment-gateway callbacks; HMAC-authenticated, org resolved from payload",
    "health.py": "liveness probe, touches no tenant data",
    "platform.py": "super_admin only; every route is intentionally cross-org platform admin",
    "donor_portal.py": "the donor's own principal surface (scoped to the calling donor)",
    "organization.py": "the caller's own organization (principal.organization_id)",
}
# Plus any ``*_self.py`` file: donor_self / guardian_self / orphan_self /
# orphanage_self — principal/self surfaces scoped to the authenticated user's
# own resources, never another org's.

# Specific endpoints that intentionally read tenant data without an org filter.
# Keyed by (filename, function name) -> one-line reason.
_EXEMPT_ENDPOINTS: dict[tuple[str, str], str] = {
    ("users.py", "accept_invite"): (
        "token-authenticated invite acceptance; the principal is resolved from "
        "the signed invite token, so there is no caller org to filter by"
    ),
}

# Route-path prefixes that are intentionally cross-org, keyed by filename.
_EXEMPT_ROUTE_PREFIXES: dict[str, tuple[str, ...]] = {
    # stats.py ``platform/*`` — super_admin platform analytics, deliberately
    # aggregate across every org (the org-scoped dashboard endpoints alongside
    # them are still checked).
    "stats.py": ("/platform/",),
}


# ── Static-analysis primitives ─────────────────────────────────────────────

# SQLAlchemy constructs / query-builder methods whose direct arguments may name
# a tenant entity (``select(Donor)``, ``.join(Orphan, ...)``).
_QUERY_ENTITY_FUNCS = frozenset(
    {"select", "insert", "update", "delete", "join", "outerjoin", "select_from"}
)
_HTTP_METHODS = frozenset({"get", "post", "put", "patch", "delete", "head", "options"})

# A raw-SQL ``text("... media ...")`` query (the ``media`` table has no ORM
# model). Matches the table only in a FROM / JOIN / INTO / UPDATE position so the
# ``media_type`` column and prose never trip it.
_MEDIA_TABLE_RE = re.compile(r"\b(?:from|join|into|update)\s+media\b", re.IGNORECASE)


def _is_org_id_column(stmt: ast.stmt) -> bool:
    """True if ``stmt`` declares an ``organization_id`` column on a model."""
    if isinstance(stmt, ast.AnnAssign):
        return isinstance(stmt.target, ast.Name) and stmt.target.id == "organization_id"
    if isinstance(stmt, ast.Assign):
        return any(isinstance(t, ast.Name) and t.id == "organization_id" for t in stmt.targets)
    return False


def _tenant_model_names() -> frozenset[str]:
    """Mapped classes that carry an ``organization_id`` column.

    Derived from ``app/models/*.py`` so a NEW tenant-owned model is guarded
    automatically rather than depending on this file being kept in sync.
    """
    names: set[str] = set()
    for path in sorted(_MODELS_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.ClassDef) and any(
                _is_org_id_column(stmt) for stmt in node.body
            ):
                names.add(node.name)
    return frozenset(names)


TENANT_MODELS: frozenset[str] = _tenant_model_names()


def _callee_name(call: ast.Call) -> str | None:
    """Best-effort name of the thing being called (``f`` or ``x.f``)."""
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


def _has_keyword(call: ast.Call, name: str) -> bool:
    return any(kw.arg == name for kw in call.keywords)


def _str_constants(call: ast.Call) -> list[str]:
    """String literals passed positionally to ``call`` (handles f-strings by
    concatenating their literal parts)."""
    out: list[str] = []
    for arg in call.args:
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            out.append(arg.value)
        elif isinstance(arg, ast.JoinedStr):
            out.append(
                "".join(
                    p.value
                    for p in arg.values
                    if isinstance(p, ast.Constant) and isinstance(p.value, str)
                )
            )
    return out


def _is_org_id_comparison(node: ast.Compare) -> bool:
    """True for ``<TenantModel>.organization_id == ...`` (or the mirror) — the
    canonical WHERE-clause scoping idiom. Excludes ``user.organization_id`` and
    non-filter uses such as ``Model.organization_id.label(...)``."""
    for operand in (node.left, *node.comparators):
        if (
            isinstance(operand, ast.Attribute)
            and operand.attr == "organization_id"
            and isinstance(operand.value, ast.Name)
            and operand.value.id in TENANT_MODELS
        ):
            return True
    return False


def _endpoint_route(func: ast.FunctionDef | ast.AsyncFunctionDef) -> str | None:
    """The route path of a ``@router.<method>("/path")`` endpoint, or ``None``
    when the function is not a router endpoint."""
    for dec in func.decorator_list:
        if (
            isinstance(dec, ast.Call)
            and isinstance(dec.func, ast.Attribute)
            and dec.func.attr in _HTTP_METHODS
            and isinstance(dec.func.value, ast.Name)
            and dec.func.value.id == "router"
        ):
            if dec.args and isinstance(dec.args[0], ast.Constant):
                value = dec.args[0].value
                return value if isinstance(value, str) else ""
            return ""
    return None


@dataclass
class _FuncFacts:
    """Direct (non-flattened) facts about one module-level function."""

    name: str
    is_endpoint: bool
    route: str | None
    queried: set[str] = field(default_factory=set)  # tenant ORM models referenced
    calls: set[str] = field(default_factory=set)  # same-file functions invoked
    has_signal: bool = False  # an org-scoping signal is present
    media_unscoped: bool = False  # raw ``media`` SQL lacking organization_id


def _facts_for(
    func: ast.FunctionDef | ast.AsyncFunctionDef, module_funcs: frozenset[str]
) -> _FuncFacts:
    route = _endpoint_route(func)
    facts = _FuncFacts(name=func.name, is_endpoint=route is not None, route=route)

    # Walk only the body (not the signature) so parameter type annotations such
    # as ``user: Annotated[User, ...]`` never count as a query.
    for stmt in func.body:
        for node in ast.walk(stmt):
            # Column reference ``Model.<col>`` — covers SELECT columns, WHERE,
            # JOIN conditions, ORDER BY, etc.
            if (
                isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Name)
                and node.value.id in TENANT_MODELS
            ):
                facts.queried.add(node.value.id)

            elif isinstance(node, ast.Compare) and _is_org_id_comparison(node):
                facts.has_signal = True  # S2: explicit organization_id filter

            elif isinstance(node, ast.Call):
                callee = _callee_name(node)
                # Whole-entity reference ``select(Donor)`` / ``.join(Orphan, …)``.
                if callee in _QUERY_ENTITY_FUNCS:
                    for arg in node.args:
                        if isinstance(arg, ast.Name) and arg.id in TENANT_MODELS:
                            facts.queried.add(arg.id)
                # S1: delegation to the canonical org-scoped fetch helper.
                if callee == "get_in_org_or_404":
                    facts.has_signal = True
                # S4: ``filter_by(organization_id=...)``.
                elif callee == "filter_by" and _has_keyword(node, "organization_id"):
                    facts.has_signal = True
                # S5: constructing a tenant row anchored to the caller's org
                # (``Donor(organization_id=user.organization_id, …)``).
                if (
                    isinstance(node.func, ast.Name)
                    and node.func.id in TENANT_MODELS
                    and _has_keyword(node, "organization_id")
                ):
                    facts.has_signal = True
                # Raw ``media`` SQL: scoped only if the statement filters on
                # organization_id (every media statement co-locates the filter).
                if callee == "text":
                    for sql in _str_constants(node):
                        if _MEDIA_TABLE_RE.search(sql) and "organization_id" not in sql.lower():
                            facts.media_unscoped = True
                # Same-file helper invocation (for closure flattening).
                if isinstance(node.func, ast.Name) and node.func.id in module_funcs:
                    facts.calls.add(node.func.id)
    return facts


def _reachable(start: str, facts_by_name: dict[str, _FuncFacts]) -> set[str]:
    """Names reachable from ``start`` through same-file calls (incl. ``start``)."""
    seen: set[str] = set()
    stack = [start]
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        seen.add(name)
        facts = facts_by_name.get(name)
        if facts is not None:
            stack.extend(facts.calls - seen)
    return seen


def _is_exempt_endpoint(filename: str, func: str, route: str | None) -> bool:
    if (filename, func) in _EXEMPT_ENDPOINTS:
        return True
    return route is not None and any(
        route.startswith(prefix) for prefix in _EXEMPT_ROUTE_PREFIXES.get(filename, ())
    )


def _violations_in_file(path: Path) -> list[str]:
    filename = path.name
    if filename in _EXEMPT_FILES or filename.endswith("_self.py"):
        return []

    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef | ast.AsyncFunctionDef)]
    module_funcs = frozenset(f.name for f in funcs)
    facts_by_name = {f.name: _facts_for(f, module_funcs) for f in funcs}

    violations: list[str] = []
    for func in funcs:
        facts = facts_by_name[func.name]
        if not facts.is_endpoint or _is_exempt_endpoint(filename, func.name, facts.route):
            continue

        queried: set[str] = set()
        scoped = False
        media_unscoped = False
        for name in _reachable(func.name, facts_by_name):
            reached = facts_by_name[name]
            queried |= reached.queried
            scoped = scoped or reached.has_signal
            media_unscoped = media_unscoped or reached.media_unscoped

        if scoped:
            continue
        if queried:
            models = ", ".join(sorted(queried))
            violations.append(
                f"{filename}::{func.name} queries tenant model(s) [{models}] without an "
                f"explicit organization_id filter, get_in_org_or_404(), or org-anchored "
                f"construct"
            )
        if media_unscoped:
            violations.append(
                f"{filename}::{func.name} runs raw SQL over the `media` table without an "
                f"organization_id filter"
            )
    return violations


# ── Tests ──────────────────────────────────────────────────────────────────


def test_no_unscoped_tenant_queries_in_v1() -> None:
    """No v1 endpoint may query a tenant-owned model without org scoping.

    If this fails on a new endpoint, scope it (``<Model>.organization_id ==
    user.organization_id`` or ``get_in_org_or_404(...)``). If the endpoint is a
    genuine, intentional exception (public / self / super-admin), add it to the
    allowlist at the top of this file WITH A ONE-LINE REASON.
    """
    violations: list[str] = []
    for path in sorted(_V1_DIR.glob("*.py")):
        violations.extend(_violations_in_file(path))

    assert not violations, "Unscoped cross-tenant queries detected:\n" + "\n".join(
        f"  - {v}" for v in violations
    )


def test_guard_scans_a_meaningful_surface() -> None:
    """Fail closed if the scanner stops seeing things — otherwise a parser/glob
    regression could let the guard pass vacuously."""
    assert _V1_DIR.is_dir(), f"router dir missing: {_V1_DIR}"

    # The tenant-model set is derived from app/models; pin the known core so a
    # broken derivation can't silently empty it.
    assert len(TENANT_MODELS) >= 12, sorted(TENANT_MODELS)
    expected_core = {
        "Orphan",
        "Donor",
        "Sponsorship",
        "Payment",
        "Family",
        "Guardian",
        "PartnerOrganization",
        "MarketingChannel",
        "BankTransfer",
        "Message",
        "Document",
        "OrphanReport",
        "User",
    }
    assert expected_core <= TENANT_MODELS, sorted(expected_core - TENANT_MODELS)

    # And the scanner must actually find a non-trivial number of endpoints in
    # the checked (non-exempt) routers.
    checked_endpoints = 0
    for path in sorted(_V1_DIR.glob("*.py")):
        if path.name in _EXEMPT_FILES or path.name.endswith("_self.py"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and (
                _endpoint_route(node) is not None
            ):
                checked_endpoints += 1
    assert checked_endpoints >= 60, checked_endpoints


def test_allowlist_entries_reference_real_files() -> None:
    """Keep the allowlist honest: every entry must point at a file that exists,
    so a rename surfaces here instead of silently disabling a check."""
    for filename in _EXEMPT_FILES:
        assert (_V1_DIR / filename).is_file(), filename
    for filename, _func in _EXEMPT_ENDPOINTS:
        assert (_V1_DIR / filename).is_file(), filename
    for filename in _EXEMPT_ROUTE_PREFIXES:
        assert (_V1_DIR / filename).is_file(), filename
