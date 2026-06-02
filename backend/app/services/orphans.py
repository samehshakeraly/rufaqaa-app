"""Shared orphan-creation path.

Both the staff endpoint (``POST /orphans``) and the guardian self-service
endpoint (``POST /guardian/me/orphans``) funnel through
:func:`create_orphan_record`, so their behaviour is identical — most
importantly the **duplicate-prevention rule**.

The canonical schema enforces a partial unique index::

    CREATE UNIQUE INDEX idx_orphans_no_duplicate ON orphans (
        organization_id, LOWER(first_name), LOWER(family_name),
        date_of_birth, father_name
    ) WHERE deleted_at IS NULL;

``father_name`` is required on the create schema, so the index has **no
NULL-father gap** — every duplicate is caught by the database. The index is the
single source of truth: a violation surfaces here as a SQLAlchemy
``IntegrityError`` which we translate into a clean ``409`` instead of letting it
bubble up as a 500. No pre-insert lookup is needed.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orphan import Orphan
from app.models.user import User
from app.schemas.orphan import OrphanCreateFields
from app.services.audit import record_audit
from app.utils.codes import generate_code

# Name of the canonical partial-unique index (see module docstring). We match
# on this specifically so an unrelated unique violation (e.g. the random
# ``code``) is NOT mistaken for a duplicate orphan and still raises a 500.
_DUPLICATE_INDEX = "idx_orphans_no_duplicate"
_DUPLICATE_DETAIL = "An orphan with the same name, date of birth and father already exists"


async def create_orphan_record(
    db: AsyncSession,
    *,
    user: User,
    data: OrphanCreateFields,
    partner_organization_id: UUID,
    family_id: UUID | None,
    via: str,
) -> Orphan:
    """Insert an orphan and commit, returning the persisted row.

    The new orphan lands in ``case_status='pending_review'`` (the model
    default), so it rides the existing supervisor approve/reject workflow.
    ``via`` ("staff" | "guardian_self") is recorded on the audit row.

    Raises ``409`` if it would violate the no-duplicate rule
    (``idx_orphans_no_duplicate``).
    """
    orphan = Orphan(
        organization_id=user.organization_id,
        partner_organization_id=partner_organization_id,
        family_id=family_id,
        code=generate_code("ORF"),
        first_name=data.first_name,
        middle_name=data.middle_name,
        family_name=data.family_name,
        full_name_en=data.full_name_en,
        date_of_birth=data.date_of_birth,
        gender=data.gender,
        nationality=data.nationality,
        father_name=data.father_name,
        father_death_date=data.father_death_date,
        created_by=user.id,
    )
    db.add(orphan)
    try:
        await db.flush()
    except IntegrityError as exc:
        # The DB unique index is the single source of truth for the
        # no-duplicate rule. Translate its violation into a clean 409; any
        # other IntegrityError is a real error and re-raised (→ 500). The
        # rollback is required because the IntegrityError aborts the
        # transaction; we don't re-query (no friendly code lookup), so there's
        # nothing more to do than surface the conflict.
        await db.rollback()
        if _DUPLICATE_INDEX in str(exc.orig):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=_DUPLICATE_DETAIL,
            ) from exc
        raise

    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.created",
        entity_type="orphan",
        entity_id=orphan.id,
        new_values={"code": orphan.code, "case_status": orphan.case_status, "via": via},
    )
    await db.commit()
    await db.refresh(orphan)
    return orphan
