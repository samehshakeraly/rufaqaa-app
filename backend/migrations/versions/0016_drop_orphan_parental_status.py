"""Drop the redundant ``orphans.parental_status`` column (covered by ``mother_status``).

Corrective follow-up to migration 0014, which introduced ``parental_status`` as a
coded column (``paternal | maternal | both | unknown``) alongside its DB CHECK
``ck_orphans_parental_status``. That column duplicates information the schema
already carries: ``mother_status`` (``alive | deceased | unknown``) combined with
the father-centric orphan definition — the father is always deceased and
``father_name`` is required — already encodes whether a child is a paternal or a
both-parent orphan. Removing the duplicate now, before any application code grows
to depend on it.

Only the column and its CHECK are touched; ``mother_status`` and the other 0014
additions (``national_id`` / ``national_id_encrypted`` / ``country_specific``) are
deliberately left in place. Fully reversible: ``downgrade`` re-adds the NULLABLE
column and recreates the CHECK, restoring 0014's state exactly.

Revision ID: 0016
Revises: 0015
Create Date: 2026-06-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | Sequence[str] | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop the CHECK before its column (dependency-safe), mirroring 0014's
    # downgrade order. mother_status already encodes paternal-vs-both, so the
    # coded column and its constraint are pure duplication.
    op.drop_constraint("ck_orphans_parental_status", "orphans", type_="check")
    op.drop_column("orphans", "parental_status")


def downgrade() -> None:
    # Restore 0014's state exactly: re-add the NULLABLE column, then recreate the
    # CHECK over its allowed set.
    op.add_column("orphans", sa.Column("parental_status", sa.String(length=20), nullable=True))
    op.create_check_constraint(
        "ck_orphans_parental_status",
        "orphans",
        "parental_status IN ('paternal', 'maternal', 'both', 'unknown')",
    )
