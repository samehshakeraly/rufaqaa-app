"""Generic org-scoped fetch for tenant-owned models.

The app connects to Postgres as a SUPERUSER, which BYPASSES Row-Level
Security, so every query over tenant-owned data must filter by
``organization_id`` EXPLICITLY in code — RLS will not save us. This helper
folds that filter into a fetch-by-id so a cross-org id returns 404
(:class:`NotFound`) rather than leaking, or even revealing the existence of,
another organization's row. It is the canonical building block for the
fetch-by-id endpoints across the API (mirrors the inline pattern landed for
families/partners in #99).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import ColumnExpressionArgument, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import Base
from app.core.exceptions import NotFound
from app.models.user import User


async def get_in_org_or_404[ModelT: Base](
    db: AsyncSession,
    model: type[ModelT],
    obj_id: UUID,
    user: User,
    *extra: ColumnExpressionArgument[bool],
) -> ModelT:
    """Return ``model`` row ``obj_id`` iff it belongs to ``user``'s org.

    Explicit org scoping, never RLS — the app's superuser connection bypasses
    RLS. A cross-org id (or any row failing an ``extra`` predicate, e.g.
    ``Model.deleted_at.is_(None)``) falls through to 404, so the row's
    existence is never revealed.

    ``model`` must be a tenant-owned mapped class carrying ``id`` and
    ``organization_id`` columns; ``filter_by`` resolves those by name on the
    primary entity, and ``extra`` adds any further WHERE predicates.
    """
    obj = await db.scalar(
        select(model).filter_by(id=obj_id, organization_id=user.organization_id).where(*extra)
    )
    if obj is None:
        raise NotFound(model.__name__)
    return obj
