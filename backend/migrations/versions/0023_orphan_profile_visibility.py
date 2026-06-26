"""Per-element donor-profile visibility on orphans.

Adds the column behind PR-1 — letting an orphanage supervisor/manager show or
hide ANY element of the donor-facing child profile, enforced in the backend:

* ``profile_visibility`` — JSONB map keyed by profile element
  (``dream`` / ``her_world`` / ``quran_growth`` / ``multidim_growth`` /
  ``milestones`` / ``recent_updates`` / ``supervisor_word`` /
  ``since_you_began``). An element is shown to donors UNLESS its key is
  explicitly ``false``; the default ``{}`` therefore means "all elements
  visible" (the product default — mirrors ``orphan_reports.section_visibility``).
  NOT NULL so the donor composition never has to guess at a missing map.

The identity/header block is implicit and always shown; it is not a member of
the registry and cannot be hidden. Fully reversible.

Revision ID: 0023
Revises: 0022
Create Date: 2026-06-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0023"
down_revision: str | Sequence[str] | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orphans",
        sa.Column(
            "profile_visibility",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("orphans", "profile_visibility")
