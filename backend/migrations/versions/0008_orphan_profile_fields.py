"""Orphan profile fields + flexible tags.

Adds optional profile columns to ``orphans`` that enrich a child's record
beyond the core identity fields — education, Qur'an memorisation, health and
free-text aspirations/challenges — plus a flexible ``tags`` array for ad-hoc
categorisation. All new columns are NULLABLE (or default-empty for ``tags``)
so neither the staff create path nor the light guardian intake is forced to
supply them.

Enum-coded columns (``education_stage``, ``health_status``,
``health_coverage``) are kept as plain VARCHARs — the allowed values are
validated in the Pydantic layer (``Literal`` types), not the DB, to avoid
shipping a migration every time a code is added.

``tags`` gets a GIN index so ``tags @> ARRAY[...]`` / overlap lookups stay
fast as the table grows.

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orphans", sa.Column("education_stage", sa.String(length=30), nullable=True))
    op.add_column("orphans", sa.Column("academic_level", sa.String(length=50), nullable=True))
    op.add_column("orphans", sa.Column("school_name", sa.String(length=255), nullable=True))
    op.add_column(
        "orphans",
        sa.Column("quran_juz_memorized", sa.SmallInteger(), nullable=True),
    )
    op.create_check_constraint(
        "ck_orphans_quran_juz_memorized_range",
        "orphans",
        "quran_juz_memorized BETWEEN 0 AND 30",
    )
    op.add_column("orphans", sa.Column("quran_note", sa.Text(), nullable=True))
    op.add_column("orphans", sa.Column("health_status", sa.String(length=20), nullable=True))
    op.add_column("orphans", sa.Column("health_coverage", sa.String(length=20), nullable=True))
    op.add_column("orphans", sa.Column("chronic_conditions", sa.Text(), nullable=True))
    op.add_column("orphans", sa.Column("aspiration", sa.Text(), nullable=True))
    op.add_column("orphans", sa.Column("challenges", sa.Text(), nullable=True))
    op.add_column(
        "orphans",
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )
    op.create_index(
        "idx_orphans_tags",
        "orphans",
        ["tags"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("idx_orphans_tags", table_name="orphans")
    op.drop_column("orphans", "tags")
    op.drop_column("orphans", "challenges")
    op.drop_column("orphans", "aspiration")
    op.drop_column("orphans", "chronic_conditions")
    op.drop_column("orphans", "health_coverage")
    op.drop_column("orphans", "health_status")
    op.drop_column("orphans", "quran_note")
    op.drop_constraint("ck_orphans_quran_juz_memorized_range", "orphans", type_="check")
    op.drop_column("orphans", "quran_juz_memorized")
    op.drop_column("orphans", "school_name")
    op.drop_column("orphans", "academic_level")
    op.drop_column("orphans", "education_stage")
