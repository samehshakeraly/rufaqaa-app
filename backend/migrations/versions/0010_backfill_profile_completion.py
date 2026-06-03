"""Backfill profile_completion_percentage for every orphan (data only).

``profile_completion_percentage`` was historically a dead column: the model
defaulted it to 0 and the demo seed assigned random values, so the figures on
disk are non-meaningful. This one-time **data** migration recomputes it for
ALL rows as an equal-weighted measure over seven enrichment fields, so a later
``min_completion`` filter is meaningful from day one.

No schema change — the column already exists (migration 0008) and the API
contract (``OrphanRead``) is unchanged.

The SQL below mirrors, field-for-field, the canonical Python definition in
``app.services.orphans.compute_profile_completion`` (the single source of
truth). The denominator is 7, which never lands on a .5 boundary for an
integer filled-count (0..7), so SQL ``round`` and Python ``round`` agree
exactly. The sibling ``profile_completion_score`` is intentionally left alone.

Revision ID: 0010
Revises: 0009
Create Date: 2026-06-03
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Mirrors app.services.orphans.compute_profile_completion field-for-field.
    op.execute(
        """
        UPDATE orphans SET profile_completion_percentage = round((
            (CASE WHEN nationality        IS NOT NULL AND btrim(nationality)        <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN education_stage     IS NOT NULL AND btrim(education_stage)     <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN school_name         IS NOT NULL AND btrim(school_name)         <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN quran_juz_memorized IS NOT NULL                                     THEN 1 ELSE 0 END)
          + (CASE WHEN health_status       IS NOT NULL AND btrim(health_status)       <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN aspiration          IS NOT NULL AND btrim(aspiration)          <> '' THEN 1 ELSE 0 END)
          + (CASE WHEN cardinality(tags) > 0                                               THEN 1 ELSE 0 END)
        )::numeric / 7 * 100)::int
        """
    )


def downgrade() -> None:
    # No-op: this is a one-time data backfill. The prior values were
    # non-meaningful (seed-random / model default 0), so there is nothing
    # meaningful to restore.
    pass
