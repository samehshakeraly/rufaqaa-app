"""Orphanage capacity — infrastructure for the house/occupancy report.

Adds a single NULLable ``capacity`` INTEGER column to ``orphanages``: the
number of residents the dar can house. NULL means "not recorded" (every
existing row), so the column lands with zero backfill. A named CHECK
(the ``media_category_check`` pattern) keeps any recorded value >= 0 —
the Pydantic layer enforces the same bound (``ge=0``) at the boundary,
the CHECK is the DB-level backstop.

Fully reversible — downgrade drops the CHECK, then the column.

Revision ID: 0032
Revises: 0031
Create Date: 2026-07-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032"
down_revision: str | Sequence[str] | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orphanages", sa.Column("capacity", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "orphanages_capacity_check",
        "orphanages",
        "capacity IS NULL OR capacity >= 0",
    )


def downgrade() -> None:
    op.drop_constraint("orphanages_capacity_check", "orphanages", type_="check")
    op.drop_column("orphanages", "capacity")
