"""Orphan self-portal schema changes (B-5).

Two changes the orphan portal depends on, applied to already-running DBs
(the canonical schema file is only loaded once, by migration 0001):

  1. messages.to_user_id becomes nullable — an orphan-composed message
     may have no resolvable recipient yet (no provisioned guardian); a
     moderator routes it manually.
  2. business_rules gains show_donor_first_name_to_orphan — the per-org
     flag that lets the "my sponsor" view show the donor's first name
     instead of the generic "كفيلك". NOT NULL, defaults FALSE.

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "messages",
        "to_user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.add_column(
        "business_rules",
        sa.Column(
            "show_donor_first_name_to_orphan",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("business_rules", "show_donor_first_name_to_orphan")
    # Coalesce any messages that were stored with a NULL recipient while
    # this revision was live, so re-adding the NOT NULL constraint can't
    # fail (a no-op on well-formed data).
    op.execute("UPDATE messages SET to_user_id = from_user_id WHERE to_user_id IS NULL")
    op.alter_column(
        "messages",
        "to_user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
