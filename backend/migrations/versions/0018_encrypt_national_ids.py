"""Encrypt existing ``national_id`` values at rest (guardians + orphans).

One-time data backfill for PR-E. The write paths now encrypt ``national_id``
into the ``national_id_encrypted`` BYTEA column (Fernet token — see
``app.core.crypto``) and never persist the plaintext. This migration brings any
pre-existing rows into the same shape: for every guardian/orphan with a
non-null plaintext ``national_id`` it writes the encrypted token and then NULLs
the plaintext column.

Schema-free: both the plaintext ``national_id`` and the ``national_id_encrypted``
columns already exist (guardians since the 0001 baseline, orphans since 0014),
so this migration only moves data. It reuses the application encryption utility
so the ciphertext is decryptable by the running app with the same
``FIELD_ENCRYPTION_KEY``.

Idempotent ``upgrade``: it only touches rows whose plaintext is still non-null,
so re-running (e.g. after a downgrade) finds nothing left to do. ``downgrade``
is a deliberate no-op — reversing would require re-deriving and re-persisting
plaintext PII (key-dependent, and undesirable), and the encrypted data stays
fully readable by the app at the 0017 schema, so leaving it in place is safe.

Revision ID: 0018
Revises: 0017
Create Date: 2026-06-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.core.crypto import encrypt_field

revision: str = "0018"
down_revision: str | Sequence[str] | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Both tables carry the identical (national_id, national_id_encrypted) pair, so
# the backfill is the same loop over each.
_TABLES: tuple[str, ...] = ("guardians", "orphans")


def upgrade() -> None:
    conn = op.get_bind()
    for table in _TABLES:
        rows = conn.execute(
            sa.text(f"SELECT id, national_id FROM {table} WHERE national_id IS NOT NULL")  # noqa: S608
        ).all()
        update = sa.text(
            f"UPDATE {table} SET national_id_encrypted = :enc, national_id = NULL "  # noqa: S608
            "WHERE id = :id"
        ).bindparams(sa.bindparam("enc", type_=sa.LargeBinary()))
        for row_id, national_id in rows:
            conn.execute(update, {"enc": encrypt_field(national_id), "id": row_id})


def downgrade() -> None:
    # No-op-safe: the forward step is a one-way normalisation. The encrypted
    # values remain valid and readable at the 0017 schema, so there is nothing
    # to undo; we deliberately do NOT re-introduce plaintext national_id.
    pass
