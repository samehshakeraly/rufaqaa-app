"""Add confirmation_document_id to bank_transfers.

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE bank_transfers "
        "ADD COLUMN IF NOT EXISTS confirmation_document_id UUID REFERENCES documents(id);"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE bank_transfers DROP COLUMN IF EXISTS confirmation_document_id;"
    )
