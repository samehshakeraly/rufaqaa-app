"""Curated "In Her Words" (بكلماتها) child phrases — donor-profile element (PR-8).

Adds a single JSONB column to ``orphans`` holding a supervisor-authored,
ordered list of short child phrases shown on the sponsored-orphan donor profile:

* ``in_her_words`` — JSONB NOT NULL, server_default ``'[]'::jsonb``. Each stored
  item is ``{"id": <uuid>, "text": <str>, "said_on": <ISO date | null>}``. The
  array order IS the display order; the staff PUT controls ordering. The block is
  governed by the existing per-element visibility map
  (``orphans.profile_visibility`` / ProfileElement.in_her_words) and stripped
  server-side when hidden — the same pattern as the other donor-profile elements.

Donor-facing projection exposes only ``text`` + ``said_on`` (never the internal
id). Fully reversible — downgrade drops the column.

Revision ID: 0025
Revises: 0024
Create Date: 2026-06-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0025"
down_revision: str | Sequence[str] | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orphans",
        sa.Column(
            "in_her_words",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("orphans", "in_her_words")
