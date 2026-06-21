"""Drop the vestigial plaintext ``national_id`` columns (orphans + guardians).

Final step of the national_id-at-rest encryption work. Since 0018 the write
paths persist only the Fernet ciphertext in ``national_id_encrypted`` (BYTEA —
see ``app.core.crypto``), and 0018 backfilled every pre-existing row before
NULLing the plaintext ``national_id`` column. No code reads or writes the
plaintext column any more — orphan national_id is write-only (never serialised)
and the guardian read path decrypts ``national_id_encrypted`` — so the columns
are now dead weight and are dropped here. ``national_id_encrypted`` is left
untouched on both tables: it holds the live data.

The plaintext column was added to ``orphans`` in 0014 and has existed on
``guardians`` since the 0001 baseline; on both it is a NULLable VARCHAR(50).
There are no indexes or constraints on it, so the drop is a plain DROP COLUMN.

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | Sequence[str] | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Both tables carry the same vestigial plaintext column; national_id_encrypted
# is the live store and stays. Real __tablename__ values: Orphan -> "orphans",
# Guardian -> "guardians".
_TABLES: tuple[str, ...] = ("orphans", "guardians")


def upgrade() -> None:
    # Drop ONLY the plaintext column on each table; national_id_encrypted is the
    # live ciphertext store and is left in place.
    for table in _TABLES:
        op.drop_column(table, "national_id")


def downgrade() -> None:
    """Re-add the plaintext ``national_id`` COLUMN only — never its values.

    This restores the empty, NULLable VARCHAR(50) column so the schema matches
    the pre-0020 shape, but the original plaintext values are intentionally
    destroyed and unrecoverable: 0018 encrypted them into national_id_encrypted
    and then NULLed the plaintext, and this DDL-only step deliberately does not
    decrypt anything. The data lives on solely in national_id_encrypted (still
    readable by the app), so the re-added column comes back NULL for every row.
    """
    # Mirror the upgrade in reverse order (the two tables are independent — no FK
    # between these columns — so order is cosmetic, but we keep the convention).
    for table in reversed(_TABLES):
        op.add_column(table, sa.Column("national_id", sa.String(length=50), nullable=True))
