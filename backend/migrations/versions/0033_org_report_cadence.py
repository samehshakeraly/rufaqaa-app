"""Per-organization reporting cadence — infrastructure for due/overdue status.

Adds a single NULLable ``report_cadence_days`` INTEGER column to
``organizations``: how many days an org allows between successive
per-child reports. NULL means "use the platform default"
(``DEFAULT_REPORT_CADENCE_DAYS``, 90 — today's window), so the column
lands with zero backfill and zero behaviour change. A named CHECK (the
``orphanages_capacity_check`` pattern) keeps any recorded value within
1..366 — the Pydantic layer enforces the same bounds (``ge=1, le=366``)
at the boundary, the CHECK is the DB-level backstop.

Fully reversible — downgrade drops the CHECK, then the column.

Revision ID: 0033
Revises: 0032
Create Date: 2026-07-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033"
down_revision: str | Sequence[str] | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "organizations", sa.Column("report_cadence_days", sa.Integer(), nullable=True)
    )
    op.create_check_constraint(
        "organizations_report_cadence_days_check",
        "organizations",
        "report_cadence_days IS NULL OR report_cadence_days BETWEEN 1 AND 366",
    )


def downgrade() -> None:
    op.drop_constraint(
        "organizations_report_cadence_days_check", "organizations", type_="check"
    )
    op.drop_column("organizations", "report_cadence_days")
