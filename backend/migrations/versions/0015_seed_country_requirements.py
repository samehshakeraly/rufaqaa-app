"""Seed ``country_requirements`` for the two fully-known countries (PS, EG).

Reference/config data for country-aware registration. Migration 0014 created the
(empty) ``country_requirements`` table and deferred seeding to "a later PR" —
this is it. Only the two countries whose rules are fully known are seeded; every
other country falls back to the permissive baseline at the read endpoint, so
seeding the full launch set is a separate, later task.

* PS (Palestine) — ``conflict`` profile: no civil registry to lean on, so a
  national id is not required (length 9 when present, no strict regex); local
  mobile prefixes 059/056.
* EG (Egypt) — ``documented`` profile: the 14-digit national id is required and
  strictly shaped; mobile prefixes 010/011/012/015.

``required_documents`` is free-form JSONB validated in the app layer, so it may
list keys (``custody_declaration``, ``inheritance_decree``) not yet in the
``documents.document_type`` enum — that enum is extended in a later PR and is
deliberately untouched here.

Idempotent: an upsert keyed on the unique ``country_code`` so re-running (or
running after a partial seed) converges to these exact rows. ``downgrade``
removes just these two rows, restoring 0014's empty table.

Revision ID: 0015
Revises: 0014
Create Date: 2026-06-18
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0015"
down_revision: str | Sequence[str] | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Upsert on the unique country_code so the seed is idempotent: a fresh row is
    # inserted, an existing one is realigned to these canonical values. The two
    # required_documents arrays are written as JSONB literals.
    op.execute(
        """
        INSERT INTO country_requirements
            (country_code, profile, national_id_required, national_id_length,
             national_id_regex, phone_regex, required_documents)
        VALUES
            ('PS', 'conflict', FALSE, 9, NULL, '^(059|056)[0-9]{7}$',
             '["photo_id", "national_id", "birth_certificate", "death_certificate",
               "custody_declaration"]'::jsonb),
            ('EG', 'documented', TRUE, 14, '^[0-9]{14}$', '^(010|011|012|015)[0-9]{8}$',
             '["photo_id", "national_id", "birth_certificate", "death_certificate",
               "custody_declaration", "inheritance_decree"]'::jsonb)
        ON CONFLICT (country_code) DO UPDATE SET
            profile = EXCLUDED.profile,
            national_id_required = EXCLUDED.national_id_required,
            national_id_length = EXCLUDED.national_id_length,
            national_id_regex = EXCLUDED.national_id_regex,
            phone_regex = EXCLUDED.phone_regex,
            required_documents = EXCLUDED.required_documents,
            updated_at = NOW();
        """
    )


def downgrade() -> None:
    # Remove only the rows this migration seeds, restoring 0014's empty table.
    op.execute("DELETE FROM country_requirements WHERE country_code IN ('PS', 'EG');")
