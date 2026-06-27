"""Categorized orphan media — donor-safe library foundation (PR-4).

Extends the EXISTING ``media`` table so staff can attach categorized,
donor-controllable artefacts (drawings, certificates, album photos, Quran
recitations, portraits) to an orphan:

* ``category`` — VARCHAR(20) NULL, CHECK in
  ('drawing','certificate','album','recitation','portrait'). NULL keeps the
  legacy report/photo rows that predate categorization valid.
* ``display_date`` — DATE NULL, a human caption date ("May 2026"); the donor
  composition falls back to ``created_at`` when it is absent.

Backfill: existing ``media_type='photo'`` rows become ``category='portrait'``
(the identity-photo default) so they keep their meaning under the new column.

Fully reversible — downgrade drops both columns (and the CHECK).

Revision ID: 0024
Revises: 0023
Create Date: 2026-06-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: str | Sequence[str] | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("media", sa.Column("category", sa.String(length=20), nullable=True))
    op.create_check_constraint(
        "media_category_check",
        "media",
        "category IN ('drawing','certificate','album','recitation','portrait')",
    )
    op.add_column("media", sa.Column("display_date", sa.Date(), nullable=True))
    # Backfill: legacy photo rows are portraits (the identity-photo default).
    op.execute("UPDATE media SET category = 'portrait' WHERE media_type = 'photo'")


def downgrade() -> None:
    op.drop_constraint("media_category_check", "media", type_="check")
    op.drop_column("media", "display_date")
    op.drop_column("media", "category")
