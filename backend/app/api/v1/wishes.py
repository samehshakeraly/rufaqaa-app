"""Staff CRUD for per-orphan wishes (R7).

Staff record a child's concrete, donor-fundable wishes (title + donor-facing
description + STAFF-ONLY internal_note + target_amount/currency); the donor
profile surfaces a minimal, gated ``wishes`` block composed in
:mod:`app.api.v1.donor_portal` — never from these endpoints.

``raised_amount`` is SYSTEM-managed and READ-ONLY here: no R7 endpoint mutates
it (only R8's payment webhook will) — the Create/Update schemas forbid it at
the Pydantic boundary. ``status`` starts ``open`` and transitions only via the
controlled PATCH field.

Org scope is ALWAYS explicit, never RLS — the app's superuser connection
bypasses RLS. Creates first load the orphan filtered by the caller's
``organization_id`` (a cross-org orphan id 404s, so a wish can never be
attached to another org's child), and every read/mutation of a wish row
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
from app.models.user import User
from app.models.wish import OrphanWish
from app.schemas.wish import WishCreate, WishRead, WishUpdate
from app.services.audit import record_audit

router = APIRouter()


@router.post(
    "/orphans/{orphan_id}/wishes",
    response_model=WishRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_orphan_wish(
    orphan_id: UUID,
    payload: WishCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> WishRead:
    """Record one wish for an orphan.

    The orphan is loaded FIRST, filtered by the caller's ``organization_id``
    (explicit scope, never RLS) — a cross-org orphan id 404s without revealing
    its existence, so a wish can never be attached to another org's child.
    The wish's org is then taken from the orphan row itself. ``raised_amount``
    / ``status`` start at the system defaults (0 / open) — neither is settable
    here.
    """
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))

    wish = OrphanWish(
        organization_id=orphan.organization_id,
        orphan_id=orphan.id,
        title=payload.title,
        description=payload.description,
        internal_note=payload.internal_note,
        target_amount=payload.target_amount,
        currency=payload.currency,
    )
    db.add(wish)
    await db.flush()
    record_audit(
        db,
        organization_id=orphan.organization_id,
        user_id=user.id,
        action="wish.created",
        entity_type="orphan_wish",
        entity_id=wish.id,
        new_values={
            "orphan_id": str(orphan.id),
            "title": payload.title,
            "target_amount": str(payload.target_amount),
            "currency": payload.currency,
        },
    )
    await db.commit()
    await db.refresh(wish)
    return WishRead.model_validate(wish)


@router.get("/orphans/{orphan_id}/wishes", response_model=list[WishRead])
async def list_orphan_wishes(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> list[WishRead]:
    """Staff view of ALL of an orphan's wishes (every status, including the
    staff-only ``internal_note``), oldest first — the donor block renders the
    same order. Explicit org scope (never RLS); a cross-org orphan id 404s
    before anything lists."""
    await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    rows = (
        await db.scalars(
            select(OrphanWish)
            .where(
                OrphanWish.orphan_id == orphan_id,
                OrphanWish.organization_id == user.organization_id,
            )
            .order_by(OrphanWish.created_at.asc())
        )
    ).all()
    return [WishRead.model_validate(w) for w in rows]


@router.patch("/wishes/{wish_id}", response_model=WishRead)
async def update_wish(
    wish_id: UUID,
    payload: WishUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> WishRead:
    """Update a wish's title/description/internal_note/target_amount/currency,
    or transition its coded ``status`` — the only controlled lifecycle surface.
    Only the fields actually supplied are applied (``exclude_unset``);
    ``raised_amount`` is not accepted at all. Explicit org scope (never RLS) —
    a cross-org wish id 404s, so no other org's row can be read or mutated."""
    wish = await db.scalar(
        select(OrphanWish).where(
            OrphanWish.id == wish_id,
            OrphanWish.organization_id == user.organization_id,
        )
    )
    if wish is None:
        raise NotFound("Wish")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        return WishRead.model_validate(wish)

    old = {
        "title": wish.title,
        "description": wish.description,
        "internal_note": wish.internal_note,
        "target_amount": str(wish.target_amount),
        "currency": wish.currency,
        "status": wish.status,
    }
    for name, value in fields.items():
        setattr(wish, name, value)
    record_audit(
        db,
        organization_id=wish.organization_id,
        user_id=user.id,
        action="wish.updated",
        entity_type="orphan_wish",
        entity_id=wish.id,
        old_values={k: old[k] for k in fields if k in old},
        new_values={k: (str(v) if k == "target_amount" else v) for k, v in fields.items()},
    )
    await db.commit()
    await db.refresh(wish)
    return WishRead.model_validate(wish)


@router.delete("/wishes/{wish_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_wish(
    wish_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> None:
    """Hard-delete one wish row. Explicit org scope (never RLS) — a cross-org
    wish id 404s rather than revealing (or deleting) another org's row."""
    wish = await db.scalar(
        select(OrphanWish).where(
            OrphanWish.id == wish_id,
            OrphanWish.organization_id == user.organization_id,
        )
    )
    if wish is None:
        raise NotFound("Wish")
    record_audit(
        db,
        organization_id=wish.organization_id,
        user_id=user.id,
        action="wish.deleted",
        entity_type="orphan_wish",
        entity_id=wish.id,
        old_values={
            "orphan_id": str(wish.orphan_id),
            "title": wish.title,
            "target_amount": str(wish.target_amount),
            "currency": wish.currency,
            "status": wish.status,
        },
    )
    await db.delete(wish)
    await db.commit()
