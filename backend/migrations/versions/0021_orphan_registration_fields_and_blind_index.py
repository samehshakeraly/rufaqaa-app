"""Orphan registration fields + national_id blind index (+ family address).

Adds the data behind a richer orphan/family registration form (PR A — backend
+ schema only). Three new columns on ``orphans``:

* ``mother_name`` / ``lives_with`` — optional registration fields. ``lives_with``
  is enum-coded and validated only in the Pydantic layer (no DB CHECK), the same
  pattern as ``education_stage`` / ``academic_level``.
* ``national_id_blind_index`` — a deterministic HMAC-SHA256 of the normalised
  national_id (see ``app.core.crypto.national_id_blind_index``). The Fernet
  ciphertext in ``national_id_encrypted`` is randomised per write, so a unique
  index on it would NOT catch the same id stored twice; the blind index is
  deterministic and does. It backs a per-organization PARTIAL UNIQUE index so a
  national_id can't be registered twice in one org. Write-only like the
  ciphertext — never serialised.

Plus four optional address columns on ``families`` (``village`` / ``street`` /
``house_number`` / ``floor``) alongside the existing city/district/address_details.

Backfill: every orphan that already has ``national_id_encrypted`` gets its blind
index computed — we decrypt the ciphertext with the SAME Fernet key the app uses
(reusing ``app.core.crypto`` exactly as migration 0018 did), normalise, and HMAC.
Rows with no ciphertext keep a NULL index. A ciphertext that fails to decrypt
ABORTS the migration: a key mismatch must never be silently swallowed.

Before creating the unique index we pre-check for existing duplicates — any
(organization_id, national_id_blind_index) shared by more than one non-deleted
orphan — and abort with the conflicting ``code``s listed, so the data can be
cleaned first rather than the index build failing opaquely.

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from cryptography.fernet import InvalidToken

from app.core.crypto import decrypt_field, national_id_blind_index

revision: str = "0021"
down_revision: str | Sequence[str] | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Per-org partial-unique index over the deterministic blind index. Its scope
# (organization_id, … WHERE deleted_at IS NULL) matches idx_orphans_no_duplicate
# so the two duplicate rules behave consistently.
_NATIONAL_ID_INDEX = "uq_orphans_national_id_per_org"


def upgrade() -> None:
    # ── New nullable columns ───────────────────────────────────────────
    op.add_column("orphans", sa.Column("mother_name", sa.String(length=255), nullable=True))
    op.add_column("orphans", sa.Column("lives_with", sa.String(length=20), nullable=True))
    op.add_column("orphans", sa.Column("national_id_blind_index", sa.LargeBinary(), nullable=True))
    op.add_column("families", sa.Column("village", sa.String(length=100), nullable=True))
    op.add_column("families", sa.Column("street", sa.String(length=255), nullable=True))
    op.add_column("families", sa.Column("house_number", sa.String(length=20), nullable=True))
    op.add_column("families", sa.Column("floor", sa.String(length=20), nullable=True))

    conn = op.get_bind()

    # ── Backfill the blind index from the existing ciphertext ──────────
    rows = conn.execute(
        sa.text(
            "SELECT id, code, national_id_encrypted FROM orphans "
            "WHERE national_id_encrypted IS NOT NULL"
        )
    ).all()
    update = sa.text("UPDATE orphans SET national_id_blind_index = :idx WHERE id = :id").bindparams(
        sa.bindparam("idx", type_=sa.LargeBinary())
    )
    for row_id, code, ciphertext in rows:
        try:
            plaintext = decrypt_field(bytes(ciphertext))
        except InvalidToken as exc:
            # A key mismatch (or corrupted token) fails loudly — silently
            # skipping would leave that orphan outside the uniqueness guarantee.
            raise RuntimeError(
                f"Cannot decrypt national_id_encrypted for orphan {code} ({row_id}); "
                "FIELD_ENCRYPTION_KEY mismatch or corrupted ciphertext. Aborting migration."
            ) from exc
        conn.execute(update, {"idx": national_id_blind_index(plaintext), "id": row_id})

    # ── Pre-check for existing duplicates before enforcing uniqueness ───
    duplicates = conn.execute(
        sa.text(
            "SELECT string_agg(code, ', ' ORDER BY code) AS codes "
            "FROM orphans "
            "WHERE national_id_blind_index IS NOT NULL AND deleted_at IS NULL "
            "GROUP BY organization_id, national_id_blind_index "
            "HAVING COUNT(*) > 1"
        )
    ).all()
    if duplicates:
        groups = "; ".join(row[0] for row in duplicates)
        raise RuntimeError(
            f"Cannot create {_NATIONAL_ID_INDEX}: the same national_id is registered more "
            f"than once within an organization. Clean these conflicting orphan groups first "
            f"(each group shares one national_id): {groups}"
        )

    # ── Per-org partial unique index (NULLs and soft-deleted rows excluded) ──
    op.create_index(
        _NATIONAL_ID_INDEX,
        "orphans",
        ["organization_id", "national_id_blind_index"],
        unique=True,
        postgresql_where=sa.text("national_id_blind_index IS NOT NULL AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    # Drop the index first (it depends on the column), then every added column.
    op.drop_index(_NATIONAL_ID_INDEX, table_name="orphans")
    op.drop_column("families", "floor")
    op.drop_column("families", "house_number")
    op.drop_column("families", "street")
    op.drop_column("families", "village")
    op.drop_column("orphans", "national_id_blind_index")
    op.drop_column("orphans", "lives_with")
    op.drop_column("orphans", "mother_name")
