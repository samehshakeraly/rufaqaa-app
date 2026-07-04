"""Staff CRUD for per-orphan needs (R7).

Staff record a child's concrete, donor-fundable material needs (title + coded
category + donor-facing description + STAFF-ONLY internal_note +
target_amount/currency); the donor profile surfaces a minimal, gated ``needs``
block composed in :mod:`app.api.v1.donor_portal` — never from these endpoints.

``raised_amount`` is SYSTEM-managed and READ-ONLY here: no R7 endpoint mutates
it (only R8's payment webhook will) — the Create/Update schemas forbid it at
the Pydantic boundary. ``status`` starts ``open`` and transitions only via the
controlled PATCH field.

Org scope is ALWAYS explicit, never RLS — the app's superuser connection
bypasses RLS. Creates first load the orphan filtered by the caller's
``organization_id`` (a cross-org orphan id 404s, so a need can never be
attached to another org's child), and every read/mutation of a need row
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
from app.models.need import OrphanNeed
from app.models.orphan import Orphan
from app.models.user import User
from app.schemas.need import NeedCreate, NeedRead, NeedUpdate
from app.services.audit import record_audit

router = APIRouter()


@router.post(
    "/orphans/{orphan_id}/needs",
    response_model=NeedRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_orphan_need(
    orphan_id: UUID,
    payload: NeedCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> NeedRead:
    """Record one need for an orphan.

    The orphan is loaded FIRST, filtered by the caller's ``organization_id``
    (explicit scope, never RLS) — a cross-org orphan id 404s without revealing
    its existence, so a need can never be attached to another org's child.
    The need's org is then taken from the orphan row itself. ``raised_amount``
    / ``status`` start at the system defaults (0 / open) — neither is settable
    here.
    """
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))

    need = OrphanNeed(
        organization_id=orphan.organization_id,
        orphan_id=orphan.id,
        title=payload.title,
        description=payload.description,
        internal_note=payload.internal_note,
        category=payload.category,
        target_amount=payload.target_amount,
        currency=payload.currency,
    )
    db.add(need)
    await db.flush()
    record_audit(
        db,
        organization_id=orphan.organization_id,
        user_id=user.id,
        action="need.created",
        entity_type="orphan_need",
        entity_id=need.id,
        new_values={
            "orphan_id": str(orphan.id),
            "title": payload.title,
            "category": payload.category,
            "target_amount": str(payload.target_amount),
            "currency": payload.currency,
        },
    )
    await db.commit()
    await db.refresh(need)
    return NeedRead.model_validate(need)


@router.get("/orphans/{orphan_id}/needs", response_model=list[NeedRead])
async def list_orphan_needs(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> list[NeedRead]:
    """Staff view of ALL of an orphan's needs (every status, including the
    staff-only ``internal_note``), oldest first — the donor block renders the
    same order. Explicit org scope (never RLS); a cross-org orphan id 404s
    before anything lists."""
    await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    rows = (
        await db.scalars(
            select(OrphanNeed)
            .where(
                OrphanNeed.orphan_id == orphan_id,
                OrphanNeed.organization_id == user.organization_id,
            )
            .order_by(OrphanNeed.created_at.asc())
        )
    ).all()
    return [NeedRead.model_validate(n) for n in rows]


@router.patch("/needs/{need_id}", response_model=NeedRead)
async def update_need(
    need_id: UUID,
    payload: NeedUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> NeedRead:
    """Update a need's title/description/internal_note/category/target_amount/
    currency, or transition its coded ``status`` — the only controlled
    lifecycle surface. Only the fields actually supplied are applied
    (``exclude_unset``); ``raised_amount`` is not accepted at all. Explicit org
    scope (never RLS) — a cross-org need id 404s, so no other org's row can be
    read or mutated."""
    need = await db.scalar(
        select(OrphanNeed).where(
            OrphanNeed.id == need_id,
            OrphanNeed.organization_id == user.organization_id,
        )
    )
    if need is None:
        raise NotFound("Need")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        return NeedRead.model_validate(need)

    old = {
        "title": need.title,
        "description": need.description,
        "internal_note": need.internal_note,
        "category": need.category,
        "target_amount": str(need.target_amount),
        "currency": need.currency,
        "status": need.status,
    }
    for name, value in fields.items():
        setattr(need, name, value)
    record_audit(
        db,
        organization_id=need.organization_id,
        user_id=user.id,
        action="need.updated",
        entity_type="orphan_need",
        entity_id=need.id,
        old_values={k: old[k] for k in fields if k in old},
        new_values={k: (str(v) if k == "target_amount" else v) for k, v in fields.items()},
    )
    await db.commit()
    await db.refresh(need)
    return NeedRead.model_validate(need)


@router.delete("/needs/{need_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_need(
    need_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> None:
    """Hard-delete one need row. Explicit org scope (never RLS) — a cross-org
    need id 404s rather than revealing (or deleting) another org's row."""
    need = await db.scalar(
        select(OrphanNeed).where(
            OrphanNeed.id == need_id,
            OrphanNeed.organization_id == user.organization_id,
        )
    )
    if need is None:
        raise NotFound("Need")
    record_audit(
        db,
        organization_id=need.organization_id,
        user_id=user.id,
        action="need.deleted",
        entity_type="orphan_need",
        entity_id=need.id,
        old_values={
            "orphan_id": str(need.orphan_id),
            "title": need.title,
            "category": need.category,
            "target_amount": str(need.target_amount),
            "currency": need.currency,
            "status": need.status,
        },
    )
    await db.delete(need)
    await db.commit()
