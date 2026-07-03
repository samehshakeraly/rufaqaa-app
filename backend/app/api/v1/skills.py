"""Staff CRUD for per-orphan skills/talents (R5).

Staff record a child's skills (name + coded category/level + a STAFF-ONLY
free-text note); the donor profile surfaces a minimal, gated ``skills`` block
composed in :mod:`app.api.v1.donor_portal` — never from these endpoints.

Org scope is ALWAYS explicit, never RLS — the app's superuser connection
bypasses RLS. Creates first load the orphan filtered by the caller's
``organization_id`` (a cross-org orphan id 404s, so a skill can never be
attached to another org's child), and every read/mutation of a skill row
carries the same ``organization_id`` predicate.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.api.deps import DbSession
from app.api.scoping import get_in_org_or_404
from app.core.authz import STAFF_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.orphan import Orphan
from app.models.skill import OrphanSkill
from app.models.user import User
from app.schemas.skill import SkillCreate, SkillRead, SkillUpdate
from app.services.audit import record_audit

router = APIRouter()


@router.post(
    "/orphans/{orphan_id}/skills",
    response_model=SkillRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_orphan_skill(
    orphan_id: UUID,
    payload: SkillCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> SkillRead:
    """Record one skill/talent for an orphan.

    The orphan is loaded FIRST, filtered by the caller's ``organization_id``
    (explicit scope, never RLS) — a cross-org orphan id 404s without revealing
    its existence, so a skill can never be attached to another org's child.
    The skill's org is then taken from the orphan row itself.
    """
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))

    skill = OrphanSkill(
        organization_id=orphan.organization_id,
        orphan_id=orphan.id,
        name=payload.name,
        category=payload.category,
        level=payload.level,
        note=payload.note,
    )
    db.add(skill)
    await db.flush()
    record_audit(
        db,
        organization_id=orphan.organization_id,
        user_id=user.id,
        action="skill.created",
        entity_type="orphan_skill",
        entity_id=skill.id,
        new_values={
            "orphan_id": str(orphan.id),
            "name": payload.name,
            "category": payload.category,
            "level": payload.level,
        },
    )
    await db.commit()
    await db.refresh(skill)
    return SkillRead.model_validate(skill)


@router.get("/orphans/{orphan_id}/skills", response_model=list[SkillRead])
async def list_orphan_skills(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> list[SkillRead]:
    """Staff view of ALL of an orphan's skills (including the staff-only
    ``note``), oldest first — the donor block renders the same order. Explicit
    org scope (never RLS); a cross-org orphan id 404s before anything lists."""
    await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    rows = (
        await db.scalars(
            select(OrphanSkill)
            .where(
                OrphanSkill.orphan_id == orphan_id,
                OrphanSkill.organization_id == user.organization_id,
            )
            .order_by(OrphanSkill.created_at.asc())
        )
    ).all()
    return [SkillRead.model_validate(s) for s in rows]


@router.patch("/skills/{skill_id}", response_model=SkillRead)
async def update_skill(
    skill_id: UUID,
    payload: SkillUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> SkillRead:
    """Update a skill's name/category/level/note. Only the fields actually
    supplied are applied (``exclude_unset``). Explicit org scope (never RLS) —
    a cross-org skill id 404s, so no other org's row can be read or mutated."""
    skill = await db.scalar(
        select(OrphanSkill).where(
            OrphanSkill.id == skill_id,
            OrphanSkill.organization_id == user.organization_id,
        )
    )
    if skill is None:
        raise NotFound("Skill")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        return SkillRead.model_validate(skill)

    old = {
        "name": skill.name,
        "category": skill.category,
        "level": skill.level,
        "note": skill.note,
    }
    for name, value in fields.items():
        setattr(skill, name, value)
    record_audit(
        db,
        organization_id=skill.organization_id,
        user_id=user.id,
        action="skill.updated",
        entity_type="orphan_skill",
        entity_id=skill.id,
        old_values={k: old[k] for k in fields if k in old},
        new_values=fields,
    )
    await db.commit()
    await db.refresh(skill)
    return SkillRead.model_validate(skill)


@router.delete("/skills/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill(
    skill_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> None:
    """Hard-delete one skill row. Explicit org scope (never RLS) — a cross-org
    skill id 404s rather than revealing (or deleting) another org's row."""
    skill = await db.scalar(
        select(OrphanSkill).where(
            OrphanSkill.id == skill_id,
            OrphanSkill.organization_id == user.organization_id,
        )
    )
    if skill is None:
        raise NotFound("Skill")
    record_audit(
        db,
        organization_id=skill.organization_id,
        user_id=user.id,
        action="skill.deleted",
        entity_type="orphan_skill",
        entity_id=skill.id,
        old_values={
            "orphan_id": str(skill.orphan_id),
            "name": skill.name,
            "category": skill.category,
            "level": skill.level,
        },
    )
    await db.delete(skill)
    await db.commit()
