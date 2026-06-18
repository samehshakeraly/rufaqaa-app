"""Country-aware orphan registration — schema foundation (no app logic).

Lays the data foundation for registering orphans whose paperwork varies by
country (conflict zones with no civil registry, fully documented states,
humanitarian caseloads). This migration adds ONLY schema — no seeds, no
endpoints, no validation logic; those land in later batches.

* ``country_requirements`` — a new GLOBAL reference/config table, modelled on
  the other public reference tables (``countries`` / ``currencies``): it has
  NO ``organization_id`` and NO row-level security, because the registration
  rules for a country are the same for every tenant. One row per country keys
  off a ``CHAR(2)`` FK to ``countries(code_alpha2)`` (mirroring the canonical
  schema's country FKs). ``required_documents`` is a JSONB array of
  document_type keys whose values are validated in the app layer, not the DB,
  so adding a document type never needs a migration.
* ``orphans`` gains four NULLABLE columns, so existing rows backfill safely:
  ``national_id`` / ``national_id_encrypted`` mirror the existing ``guardians``
  pair (plaintext VARCHAR + AES-256 ``BYTEA``; this PR adds the columns only,
  no encryption logic), ``parental_status`` is a small coded column with a DB
  CHECK (the established father-specific columns are left untouched), and
  ``country_specific`` is a JSONB bag for the per-country answers captured at
  intake.

The canonical schema file (``docs/technical/01_database_schema.sql``) is the
0001 baseline and is deliberately NOT edited; every delta lives here. No rows
are seeded — seeding ``country_requirements`` is a later PR. Fully reversible:
``downgrade`` drops the four ``orphans`` columns (and the CHECK) then the
``country_requirements`` table, restoring the exact prior state.

Revision ID: 0014
Revises: 0013
Create Date: 2026-06-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── country_requirements: GLOBAL reference/config, like countries /
    #    currencies — NO organization_id, NO RLS. Written as raw SQL (like the
    #    orphanages table in 0011) for full fidelity on the CHAR(2) FK to
    #    countries(code_alpha2). The profile CHECK is named explicitly;
    #    required_documents is a JSONB array validated at the app layer. ──
    op.execute(
        """
        CREATE TABLE country_requirements (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            country_code CHAR(2) NOT NULL UNIQUE REFERENCES countries(code_alpha2),
            profile VARCHAR(20) NOT NULL
                CONSTRAINT country_requirements_profile_check
                CHECK (profile IN ('conflict', 'documented', 'humanitarian')),
            national_id_required BOOLEAN NOT NULL DEFAULT FALSE,
            national_id_length INT,
            national_id_regex VARCHAR(255),
            phone_regex VARCHAR(255),
            required_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        """
    )

    # ── orphans: four NULLABLE columns for country-aware intake. national_id /
    #    national_id_encrypted mirror the guardians pair (plaintext + BYTEA);
    #    this PR adds the columns only. parental_status carries a DB CHECK like
    #    the small coded columns in 0009. country_specific is a JSONB bag,
    #    NOT NULL defaulting to an empty object. ──
    op.add_column("orphans", sa.Column("national_id", sa.String(length=50), nullable=True))
    op.add_column(
        "orphans",
        sa.Column("national_id_encrypted", sa.LargeBinary(), nullable=True),
    )
    op.add_column("orphans", sa.Column("parental_status", sa.String(length=20), nullable=True))
    op.create_check_constraint(
        "ck_orphans_parental_status",
        "orphans",
        "parental_status IN ('paternal', 'maternal', 'both', 'unknown')",
    )
    op.add_column(
        "orphans",
        sa.Column(
            "country_specific",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    # Reverse precisely, in dependency-safe order: drop the orphans columns
    # (the CHECK before its column) then the reference table (its UNIQUE/FK and
    # the profile CHECK are dropped with it).
    op.drop_column("orphans", "country_specific")
    op.drop_constraint("ck_orphans_parental_status", "orphans", type_="check")
    op.drop_column("orphans", "parental_status")
    op.drop_column("orphans", "national_id_encrypted")
    op.drop_column("orphans", "national_id")
    op.drop_table("country_requirements")
