"""Current organization read + admin-only PATCH."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.organization import Organization
from app.models.user import User
from app.schemas.organization import OrganizationRead, OrganizationUpdate
from app.services.audit import record_audit

router = APIRouter()


@router.get("", response_model=OrganizationRead)
async def get_current_organization(
    db: DbSession,
    user: CurrentUser,
) -> OrganizationRead:
    org = await db.scalar(select(Organization).where(Organization.id == user.organization_id))
    if org is None:
        raise NotFound("Organization")
    return OrganizationRead.model_validate(org)


@router.patch("", response_model=OrganizationRead)
async def update_current_organization(
    payload: OrganizationUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> OrganizationRead:
    org = await db.scalar(select(Organization).where(Organization.id == user.organization_id))
    if org is None:
        raise NotFound("Organization")

    changes: dict[str, dict[str, str | None]] = {}
    for field, value in payload.model_dump(exclude_unset=True).items():
        old = getattr(org, field)
        if old != value:
            changes[field] = {
                "old": str(old) if old is not None else None,
                "new": str(value) if value is not None else None,
            }
            setattr(org, field, value)

    if changes:
        record_audit(
            db,
            organization_id=user.organization_id,
            user_id=user.id,
            action="organization.updated",
            entity_type="organization",
            entity_id=org.id,
            old_values={k: v["old"] for k, v in changes.items()},
            new_values={k: v["new"] for k, v in changes.items()},
        )
    await db.commit()
    await db.refresh(org)
    return OrganizationRead.model_validate(org)
