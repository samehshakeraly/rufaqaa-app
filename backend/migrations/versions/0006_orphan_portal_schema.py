"""Orphan self-portal schema changes (B-5).

Two changes the orphan portal depends on, applied to already-running DBs
(the canonical schema file is only loaded once, by migration 0001):

  1. messages.to_user_id becomes nullable — an orphan-composed message
     may have no resolvable recipient yet (no provisioned guardian); a
     moderator routes it manually.
  2. business_rules gains show_donor_first_name_to_orphan — the per-org
     flag that lets the "my sponsor" view show the donor's first name
     instead of the generic "كفيلك". Defaults FALSE.

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-29
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE messages ALTER COLUMN to_user_id DROP NOT NULL;")
    op.execute(
        "ALTER TABLE business_rules "
        "ADD COLUMN IF NOT EXISTS show_donor_first_name_to_orphan "
        "BOOLEAN NOT NULL DEFAULT FALSE;"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE business_rules DROP COLUMN IF EXISTS show_donor_first_name_to_orphan;")
    # Restore the NOT NULL constraint. Any rows created with a NULL
    # recipient while this revision was live would block the constraint,
    # so coalesce them to from_user_id first (a no-op on well-formed data).
    op.execute("UPDATE messages SET to_user_id = from_user_id WHERE to_user_id IS NULL;")
    op.execute("ALTER TABLE messages ALTER COLUMN to_user_id SET NOT NULL;")
