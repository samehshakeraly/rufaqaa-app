"""Role-based access control.

Endpoints declare the minimum role(s) they accept via the `require_roles`
dependency. The seed `super_admin` always passes; everyone else must hold
one of the listed roles. This is intentionally coarse — feature-level
permissions on top of roles will follow.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status

from app.api.deps import get_current_user
from app.models.user import User

Role = str

# Common role groupings — keep them short and centralised so the call sites
# read fluently (`require_roles(STAFF_ROLES)`).
ADMIN_ROLES: tuple[Role, ...] = ("super_admin", "org_admin")
# Roles whose access is confined to a single partner organization (جهة): they
# read and write only within their own جهة. ADMIN_ROLES and every other role
# are NOT partner-scoped. The actual scoping lives at the call sites (explicit
# checks, not RLS) — see ``partner_scope_hides`` and the orphan write paths.
PARTNER_SCOPED_ROLES: tuple[Role, ...] = ("partner_manager", "partner_staff")
# Finance-facing views (overdue donors, reconciliation lists).
FINANCE_ROLES: tuple[Role, ...] = ("finance", *ADMIN_ROLES)
# Marketing-facing views (channel goals / progress).
MARKETING_ROLES: tuple[Role, ...] = ("marketing_manager", *ADMIN_ROLES)
STAFF_ROLES: tuple[Role, ...] = (
    "super_admin",
    "org_admin",
    "partner_manager",
    "partner_staff",
    "marketing_manager",
    "finance",
)
DONOR_ROLE: Role = "donor"


def partner_scope_hides(user: User, partner_organization_id: UUID | None) -> bool:
    """Whether a partner-scoped caller must NOT see/touch a row owned by
    ``partner_organization_id``.

    The single predicate behind partner-جهة scoping. A caller outside
    ``PARTNER_SCOPED_ROLES`` is never restricted (returns ``False``). A scoped
    caller with no جهة assigned is hidden from *everything*; otherwise a row is
    hidden unless it belongs to the caller's own جهة. Used to mirror PR-2's read
    404 on the write paths so a foreign-جهة orphan never leaks its existence.
    """
    if user.role not in PARTNER_SCOPED_ROLES:
        return False
    if user.partner_organization_id is None:
        return True
    return partner_organization_id != user.partner_organization_id


def require_roles(*allowed: Role) -> Callable[..., Awaitable[User]]:
    """FastAPI dependency factory. Use as `Depends(require_roles("org_admin"))`."""
    if not allowed:
        raise ValueError("require_roles called without any roles")
    allowed_set = set(allowed)

    async def _checker(
        user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if user.role == "super_admin" or user.role in allowed_set:
            return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Requires one of: {sorted(allowed_set)}",
        )

    return _checker


def require_verified_donor() -> Callable[..., Awaitable[User]]:
    """Donor-area gate: must hold role='donor' AND have a verified
    email. Browse routes don't need this; only state-changing routes
    (sponsorship create, payment initiate) do.

    Public routes use no auth at all; admin routes use require_roles.
    """

    async def _checker(
        user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if user.role != DONOR_ROLE and user.role != "super_admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Donor account required",
            )
        if user.email_verified_at is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Email verification required",
            )
        return user

    return _checker
