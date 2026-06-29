"""Father's memory (ذكرى الأب) — guardian-consent gate, donor-profile element (PR-11).

Adds a single boolean column to ``orphans`` that gates donor disclosure of the
deceased father's memory:

* ``father_memory_consent`` — BOOLEAN NOT NULL, server_default ``'false'``. The
  donor-facing "father's memory" block (the father's name + the YEAR of death)
  is exposed ONLY when this consent is on record AND the supervisor left the
  ``father_memory`` element visible (``orphans.profile_visibility``). Default is
  hidden — disclosure requires an explicit, deliberate guardian consent. The
  father's death CERTIFICATE and the full death DATE are never exposed; only the
  year leaves the server.

Fully reversible — downgrade drops the column.

Revision ID: 0026
Revises: 0025
Create Date: 2026-06-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: str | Sequence[str] | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orphans",
        sa.Column(
            "father_memory_consent",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("orphans", "father_memory_consent")
