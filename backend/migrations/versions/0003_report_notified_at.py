"""Add donors_notified_at to orphan_reports for publish-idempotency.

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE orphan_reports "
        "ADD COLUMN IF NOT EXISTS donors_notified_at TIMESTAMPTZ;"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE orphan_reports DROP COLUMN IF EXISTS donors_notified_at;")
