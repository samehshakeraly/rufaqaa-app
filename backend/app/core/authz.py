"""Role-based access control.

Endpoints declare the minimum role(s) they accept via the `require_roles`
dependency. The seed `super_admin` always passes; everyone else must hold
one of the listed roles. This is intentionally coarse — feature-level
permissions on top of roles will follow.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.api.deps import get_current_user
from app.models.user import User

Role = str

# Common role groupings — keep them short and centralised so the call sites
# read fluently (`require_roles(STAFF_ROLES)`).
ADMIN_ROLES: tuple[Role, ...] = ("super_admin", "org_admin")
STAFF_ROLES: tuple[Role, ...] = (
    "super_admin",
    "org_admin",
    "partner_manager",
    "partner_staff",
    "marketing_manager",
    "finance",
)
DONOR_ROLE: Role = "donor"


def require_roles(*allowed: Role):
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


def require_verified_donor():
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
