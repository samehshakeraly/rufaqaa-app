"""Small identity fields — orphan languages / current juz', guardian occupation (R1).

Adds three static columns, all validated in the Pydantic layer only (no DB
CHECK constraints — the same pattern as ``tags`` / ``quran_juz_memorized``):

* ``orphans.languages`` — TEXT[] NOT NULL, server_default ``'{}'::text[]``
  (mirrors ``orphans.tags`` exactly). The languages the child speaks, shown on
  the always-visible donor identity block.
* ``orphans.current_juz`` — SMALLINT, nullable. The juz' the child is
  currently memorising (1–30 in Pydantic); surfaces on the gated ``her_world``
  donor block.
* ``guardians.occupation`` — VARCHAR(100), nullable. Staff-facing only in this
  batch — it is NOT exposed on any donor surface.

The derived donor-facing ``orphan_status`` (father/both) deliberately has NO
column here: it is computed from ``mother_status`` at read time (migration
0016 dropped the stored ``parental_status`` for good).

Fully reversible — downgrade drops the three columns.

Revision ID: 0027
Revises: 0026
Create Date: 2026-07-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0027"
down_revision: str | Sequence[str] | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orphans",
        sa.Column(
            "languages",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )
    op.add_column(
        "orphans",
        sa.Column("current_juz", sa.SmallInteger(), nullable=True),
    )
    op.add_column(
        "guardians",
        sa.Column("occupation", sa.String(length=100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("guardians", "occupation")
    op.drop_column("orphans", "current_juz")
    op.drop_column("orphans", "languages")
