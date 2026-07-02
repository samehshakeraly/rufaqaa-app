"""Static health fields — orphan last checkup / vaccinations status (R2).

Adds two static, nullable columns, both validated in the Pydantic layer only
(no DB CHECK constraints — the same pattern as ``health_status``):

* ``orphans.last_checkup`` — DATE, nullable. The date of the child's most
  recent medical checkup.
* ``orphans.vaccinations_status`` — VARCHAR(20), nullable. Coded
  (up_to_date / partial / unknown), enforced by the ``VaccinationsStatus``
  Literal on the create/update schemas.

Together with the existing coded ``health_status`` they back the NEW gated
donor ``health`` element (ProfileElement.health) — a deliberately minimal,
reassuring slice. ``health_coverage`` / ``chronic_conditions`` / ``challenges``
stay staff-only and gain no donor surface here.

Fully reversible — downgrade drops the two columns.

Revision ID: 0028
Revises: 0027
Create Date: 2026-07-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: str | Sequence[str] | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orphans",
        sa.Column("last_checkup", sa.Date(), nullable=True),
    )
    op.add_column(
        "orphans",
        sa.Column("vaccinations_status", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("orphans", "vaccinations_status")
    op.drop_column("orphans", "last_checkup")
