"""Orphan availability + priority fields (orphan browsing foundation).

Adds the data the donor-facing orphan browse will build on, WITHOUT any of
the query/filter/sort behaviour (those land in later batches):

* ``available_since`` — TIMESTAMPTZ, NULL until the child first enters the
  available pool. Backfilled from ``created_at`` for rows already
  ``case_status='available'`` so existing cases have a sensible anchor from
  day one.
* ``mother_status`` — alive/deceased/unknown, default ``unknown``.
* ``priority_level`` — normal/high/urgent, default ``normal``.

Both coded columns are NOT NULL with a server default and a named CHECK
constraint: their allowed sets are small and stable, so the DB enforces them
directly — unlike the larger, evolving profile enums in 0008, which are
validated only in the Pydantic layer.

A composite index on ``(organization_id, case_status, available_since)``
supports the org-scoped "available, newest first" listing a later batch adds.

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orphans",
        sa.Column("available_since", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        "orphans",
        sa.Column(
            "mother_status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'unknown'"),
        ),
    )
    op.add_column(
        "orphans",
        sa.Column(
            "priority_level",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'normal'"),
        ),
    )
    op.create_check_constraint(
        "ck_orphans_mother_status",
        "orphans",
        "mother_status IN ('alive', 'deceased', 'unknown')",
    )
    op.create_check_constraint(
        "ck_orphans_priority_level",
        "orphans",
        "priority_level IN ('normal', 'high', 'urgent')",
    )
    op.create_index(
        "idx_orphans_available_since",
        "orphans",
        ["organization_id", "case_status", "available_since"],
    )
    # Backfill: existing available cases get anchored to when they were created
    # so they don't all collapse to NULL. Only touches rows still unset.
    op.execute(
        "UPDATE orphans SET available_since = created_at "
        "WHERE case_status = 'available' AND available_since IS NULL"
    )


def downgrade() -> None:
    op.drop_index("idx_orphans_available_since", table_name="orphans")
    op.drop_constraint("ck_orphans_priority_level", "orphans", type_="check")
    op.drop_column("orphans", "priority_level")
    op.drop_constraint("ck_orphans_mother_status", "orphans", type_="check")
    op.drop_column("orphans", "mother_status")
    op.drop_column("orphans", "available_since")
