"""Independence stage — orphan readiness-for-independence stage (R6).

Adds one static, nullable, coded column, validated in the Pydantic layer only
(no DB CHECK constraint — the same pattern as ``mother_status`` /
``health_status``):

* ``orphans.independence_stage`` — VARCHAR(30), nullable. The child's current
  readiness-for-independence stage, coded by the ordered ``IndependenceStage``
  Literal (childhood → skill_building → vocational_training → empowerment →
  independence), enforced on the create/update schemas.

It backs the NEW gated donor ``independence`` element
(ProfileElement.independence) — a single-field slice carrying ONLY the coded
stage; the frontend derives the "next step" from the ordered vocabulary and
localizes the empowerment charter (no extra data field).

Fully reversible — downgrade drops the column.

Revision ID: 0030
Revises: 0029
Create Date: 2026-07-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030"
down_revision: str | Sequence[str] | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orphans",
        sa.Column("independence_stage", sa.String(length=30), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("orphans", "independence_stage")
