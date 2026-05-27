"""Add initiated_by_user_id to payments for admin-on-behalf flow.

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE payments "
        "ADD COLUMN IF NOT EXISTS initiated_by_user_id UUID REFERENCES users(id);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_payments_initiated_by "
        "ON payments(initiated_by_user_id) WHERE initiated_by_user_id IS NOT NULL;"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_payments_initiated_by;")
    op.execute("ALTER TABLE payments DROP COLUMN IF EXISTS initiated_by_user_id;")
