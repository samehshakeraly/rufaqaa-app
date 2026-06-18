"""Extend the ``documents.document_type`` CHECK for country-aware registration.

Widens the allowed set the ``documents`` table accepts by four values, in
support of the country-aware intake flows laid down in 0014–0015:

* ``custody_declaration`` / ``inheritance_decree`` — guardianship and estate
  paperwork captured for both documented-state and conflict-zone intake.
* ``dwelling_photo`` — proof-of-dwelling evidence for humanitarian caseloads.
* ``displacement_proof`` — displacement evidence for conflict-zone intake.

The document_type CHECK is an inline column constraint in the canonical schema
(``docs/technical/01_database_schema.sql``, loaded verbatim by 0001), so
Postgres auto-named it ``documents_document_type_check`` (confirmed against the
live catalog). We swap the constraint wholesale — dropping the auto-named
baseline CHECK and recreating it over the widened set under the project's
explicit ``ck_<table>_<column>`` convention (``ck_documents_document_type``) —
rather than trying to mutate it in place, mirroring the role-enum widening in
0011.

Purely additive to the allowed values, so NO data migration is needed: every
existing row already satisfies the wider set. The matching API-level allow-list
is the ``DocumentType`` Literal in ``backend/app/schemas/document.py``, extended
in lockstep so the DB CHECK and the Literal list an identical set. The canonical
schema file is the 0001 baseline and is deliberately NOT edited.

Fully reversible: ``downgrade`` drops ``ck_documents_document_type`` and
recreates the original CHECK — only the baseline 10 values, under its original
auto-name ``documents_document_type_check`` — restoring 0016's state exactly.
This is schema-only (no write-path yet emits the new values), so no row can
hold one when ``downgrade`` runs; the later write-path PR owns any down-data
concern of its own.

Revision ID: 0017
Revises: 0016
Create Date: 2026-06-18
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0017"
down_revision: str | Sequence[str] | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# The baseline (0001) constraint is an inline, unnamed column CHECK that
# Postgres auto-named ``documents_document_type_check``; the widened constraint
# adopts the project's explicit ``ck_<table>_<column>`` convention. Pinning both
# names keeps the rename (and its reversal) explicit and typo-proof.
_OLD_CONSTRAINT = "documents_document_type_check"
_NEW_CONSTRAINT = "ck_documents_document_type"

# The 10 document types carried by the 0001 baseline.
_TYPES_BEFORE = (
    "'birth_certificate', 'death_certificate', 'national_id', 'passport', "
    "'bank_statement', 'school_certificate', 'medical_report', 'photo_id', "
    "'family_record', 'other'"
)
# The four country-aware additions, concatenated so the delta over the baseline
# set is explicit (custody/inheritance, proof-of-dwelling, displacement).
_TYPES_AFTER = (
    _TYPES_BEFORE
    + ", 'custody_declaration', 'inheritance_decree', 'dwelling_photo', 'displacement_proof'"
)


def upgrade() -> None:
    # Swap the auto-named baseline CHECK for the widened set under the ``ck_`` name.
    op.drop_constraint(_OLD_CONSTRAINT, "documents", type_="check")
    op.create_check_constraint(_NEW_CONSTRAINT, "documents", f"document_type IN ({_TYPES_AFTER})")


def downgrade() -> None:
    # Restore 0016's state exactly: the original 10-value CHECK under its
    # original auto-name.
    op.drop_constraint(_NEW_CONSTRAINT, "documents", type_="check")
    op.create_check_constraint(_OLD_CONSTRAINT, "documents", f"document_type IN ({_TYPES_BEFORE})")
