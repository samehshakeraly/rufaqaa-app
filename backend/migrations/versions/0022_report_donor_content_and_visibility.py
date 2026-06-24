"""Donor-facing report content + per-section visibility.

Adds the columns behind PR 2A — exposing orphan-report section content to
donors with per-section supervisor control — on ``orphan_reports``:

* ``section_visibility`` — JSONB map keyed by section
  (``education`` / ``quran`` / ``activities`` / ``health`` / ``psychological``).
  A section is shown to donors UNLESS its key is explicitly ``false``; the
  default ``{}`` therefore means "all sections visible" (the product default —
  the supervisor hides per section/report). NOT NULL so the donor projection
  never has to guess at a missing map.
* ``donor_message`` — the supervisor's warm note to the sponsor (nullable).
* ``is_milestone`` / ``milestone_label`` — flag + localized label for
  milestone reports (e.g. finished a new juz). ``is_milestone`` is NOT NULL
  DEFAULT false so existing rows read as non-milestone.

The section content itself stays in the existing JSONB columns
(``educational_progress`` etc.); this migration only adds the visibility map
and the donor-facing extras. Fully reversible.

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0022"
down_revision: str | Sequence[str] | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orphan_reports",
        sa.Column(
            "section_visibility",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column("orphan_reports", sa.Column("donor_message", sa.Text(), nullable=True))
    op.add_column(
        "orphan_reports",
        sa.Column(
            "is_milestone",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column("orphan_reports", sa.Column("milestone_label", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("orphan_reports", "milestone_label")
    op.drop_column("orphan_reports", "is_milestone")
    op.drop_column("orphan_reports", "donor_message")
    op.drop_column("orphan_reports", "section_visibility")
