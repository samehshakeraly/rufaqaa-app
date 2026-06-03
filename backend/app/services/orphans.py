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

``father_name`` is required on the create schema, so the index has no
NULL-father gap — every duplicate is caught. We surface it as a clean ``409``
two ways: a pre-insert lookup gives the friendly message (with the existing
``ORF-`` code embedded so the UI can link to it) in the common case, and the
``IntegrityError`` is also caught as a backstop for the rare race between two
identical concurrent creates — never an unhandled 500.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
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


def stamp_available_since(orphan: Orphan) -> None:
    """Stamp ``available_since`` the first time an orphan enters the available
    pool.

    Idempotent and centralised: call this from *every* site that moves an
    orphan to ``case_status='available'``. It records the current time only
    when the field is still NULL and **never** overwrites an existing value,
    so a child that bounces in and out of the pool keeps its original
    availability anchor.
    """
    if orphan.available_since is None:
        orphan.available_since = datetime.now(UTC)


def _is_filled_str(value: str | None) -> bool:
    """A string enrichment field counts as filled when it is present and not
    just whitespace."""
    return value is not None and value.strip() != ""


def compute_profile_completion(orphan: Orphan) -> int:
    """Equal-weighted profile-completion percentage (0–100) over seven
    enrichment fields.

    This function is the **single source of truth** for the measure; the 0010
    data migration mirrors it field-for-field in SQL and the demo seed calls it
    directly. "Filled" rules:

    * string fields (``nationality``, ``education_stage``, ``school_name``,
      ``health_status``, ``aspiration``) — non-NULL and not whitespace-only;
    * ``quran_juz_memorized`` — non-NULL (0 is a *known* value, so it counts);
    * ``tags`` — a non-empty list.

    The denominator is 7, which never lands on a .5 boundary for an integer
    filled-count (0..7), so Python ``round`` and SQL ``round`` agree exactly.
    """
    filled = sum(
        1
        for is_filled in (
            _is_filled_str(orphan.nationality),
            _is_filled_str(orphan.education_stage),
            _is_filled_str(orphan.school_name),
            orphan.quran_juz_memorized is not None,
            _is_filled_str(orphan.health_status),
            _is_filled_str(orphan.aspiration),
            bool(orphan.tags),
        )
        if is_filled
    )
    return round(filled / 7 * 100)


def recompute_profile_completion(orphan: Orphan) -> None:
    """Refresh the stored ``profile_completion_percentage`` from the orphan's
    current field values. Deliberately leaves ``profile_completion_score``
    alone — that sibling column is unused everywhere."""
    orphan.profile_completion_percentage = compute_profile_completion(orphan)


def _duplicate_detail(existing_code: str | None) -> str:
    detail = "An orphan with the same name, date of birth and father already exists"
    return f"{detail} ({existing_code})" if existing_code else detail


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

    Raises ``409`` if it would violate the no-duplicate rule.
    """
    # Friendly pre-check: the DB unique index is the real guard, but looking up
    # the conflicting row first lets us return a clear 409 with the existing
    # code. Runs in the request's RLS org context, so it is org-scoped.
    existing = await _find_duplicate(db, user.organization_id, data)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_duplicate_detail(existing.code),
        )

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
        education_stage=data.education_stage,
        academic_level=data.academic_level,
        school_name=data.school_name,
        quran_juz_memorized=data.quran_juz_memorized,
        quran_note=data.quran_note,
        health_status=data.health_status,
        health_coverage=data.health_coverage,
        chronic_conditions=data.chronic_conditions,
        aspiration=data.aspiration,
        challenges=data.challenges,
        tags=data.tags,
        mother_status=data.mother_status,
        priority_level=data.priority_level,
        created_by=user.id,
    )
    # New orphans normally land in 'pending_review' (the model default), but if
    # one is ever created already in the available pool, anchor it now too.
    if orphan.case_status == "available":
        stamp_available_since(orphan)
    # Single chokepoint for the derived completion%, so both the staff create
    # and the guardian self-service create (which delegates here) get it.
    recompute_profile_completion(orphan)
    db.add(orphan)
    try:
        await db.flush()
    except IntegrityError as exc:
        # Backstop for the race between two identical concurrent creates that
        # both passed the pre-check. The IntegrityError aborts the transaction,
        # so roll back and return a 409 (without re-querying — the session is
        # poisoned and its RLS context was discarded by the rollback).
        await db.rollback()
        if _DUPLICATE_INDEX in str(exc.orig):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=_duplicate_detail(None),
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


async def _find_duplicate(
    db: AsyncSession, organization_id: UUID, data: OrphanCreateFields
) -> Orphan | None:
    """Return the non-deleted orphan that would collide on the no-duplicate
    index, if any — mirroring ``idx_orphans_no_duplicate`` exactly."""
    match: Orphan | None = await db.scalar(
        select(Orphan).where(
            Orphan.organization_id == organization_id,
            func.lower(Orphan.first_name) == data.first_name.lower(),
            func.lower(Orphan.family_name) == data.family_name.lower(),
            Orphan.date_of_birth == data.date_of_birth,
            Orphan.father_name == data.father_name,
            Orphan.deleted_at.is_(None),
        )
    )
    return match
