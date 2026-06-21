"""Seed 17 more countries (registry + requirement profiles) beyond PS/EG.

Expands the launch set onto the existing data foundation: the ``countries``
registry (created/seeded by the 0001 canonical baseline) and
``country_requirements`` (created in 0014, first seeded for PS/EG in 0015). Each
new country is mapped to one of the three EXISTING requirement models —
``conflict`` / ``documented`` / ``humanitarian`` — with NO per-country
national-id / phone overrides; those land in a later PR. PS and EG are left
exactly as they are (never re-inserted, never modified).

Findings from inspecting the live state (drove the two asymmetries below):

* ``countries`` is NOT empty: the 0001 migration loads the canonical SQL
  verbatim, which already seeds ten sample rows. Three of the seventeen —
  **SY / YE / SD** — therefore already exist. For them the ``countries`` upsert
  only (re)asserts ``is_active = TRUE`` (it does not disturb their existing
  name/flag/phone); the other fourteen are fresh inserts. ``country_requirements``
  held only PS/EG, so all seventeen requirement rows are genuinely new here.

* Names live in DB columns (``name_ar`` / ``name_en``), exactly how PS/EG are
  represented — there is no ``name_fr`` column and the read API
  (``CountryListItem``) exposes only ``name_ar`` / ``name_en`` (the French UI
  falls back to ``name_en``). So names are populated here and NO i18n keys are
  added; the brief's French spellings have no PS/EG-equivalent storage.

* ``national_id_required`` is set per row to mirror each model's generic default
  (conflict/humanitarian → FALSE, documented → TRUE), matching how PS (FALSE)
  and EG (TRUE) are seeded. This column — not the profile — is what the resolver
  reads when a row exists, so a documented row left at the table default (FALSE)
  would wrongly not require an id. ``national_id_length`` / ``national_id_regex``
  / ``phone_regex`` stay NULL and ``required_documents`` stays ``[]`` (their
  column defaults): the documented model carries NO country-specific id format
  (Egypt's 14-digit rule lives only in EG's own row), so JO/TN/TR/PK/BD/ID
  inherit a generic "id required, no format" rule until per-country overrides
  arrive — verified safe against ``_validate_national_id``.

FK order is respected: ``upgrade`` inserts ``countries`` before
``country_requirements``; ``downgrade`` deletes ``country_requirements`` before
``countries``. Idempotent via upserts keyed on the unique code in each table.

Reversibility: ``downgrade`` removes all seventeen ``country_requirements`` rows
(all introduced here) but, from ``countries``, removes ONLY the fourteen rows
this migration introduced — SY/YE/SD predate it (0001 baseline) and may be
referenced by existing rows (``orphans.nationality``, ``donors.*`` …), so
deleting them would corrupt the baseline and could violate those FKs. PS/EG are
never touched, in either direction.

Revision ID: 0019
Revises: 0018
Create Date: 2026-06-21
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0019"
down_revision: str | Sequence[str] | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1. countries registry (parent — insert BEFORE country_requirements to
    #    respect the CHAR(2) FK country_requirements.country_code →
    #    countries.code_alpha2). All seventeen are upserted with is_active = TRUE,
    #    mirroring the canonical seed columns (code_alpha3, flag_emoji,
    #    phone_code). SY/YE/SD already exist (0001 baseline), so the ON CONFLICT
    #    path only re-asserts is_active for them; the other fourteen are inserted. ──
    op.execute(
        """
        INSERT INTO countries
            (code_alpha2, code_alpha3, name_ar, name_en, flag_emoji, phone_code, is_active)
        VALUES
            ('SY', 'SYR', 'سوريا', 'Syria', '🇸🇾', '+963', TRUE),
            ('YE', 'YEM', 'اليمن', 'Yemen', '🇾🇪', '+967', TRUE),
            ('SD', 'SDN', 'السودان', 'Sudan', '🇸🇩', '+249', TRUE),
            ('JO', 'JOR', 'الأردن', 'Jordan', '🇯🇴', '+962', TRUE),
            ('TN', 'TUN', 'تونس', 'Tunisia', '🇹🇳', '+216', TRUE),
            ('TR', 'TUR', 'تركيا', 'Turkey', '🇹🇷', '+90', TRUE),
            ('PK', 'PAK', 'باكستان', 'Pakistan', '🇵🇰', '+92', TRUE),
            ('BD', 'BGD', 'بنغلاديش', 'Bangladesh', '🇧🇩', '+880', TRUE),
            ('ID', 'IDN', 'إندونيسيا', 'Indonesia', '🇮🇩', '+62', TRUE),
            ('LB', 'LBN', 'لبنان', 'Lebanon', '🇱🇧', '+961', TRUE),
            ('ET', 'ETH', 'إثيوبيا', 'Ethiopia', '🇪🇹', '+251', TRUE),
            ('KE', 'KEN', 'كينيا', 'Kenya', '🇰🇪', '+254', TRUE),
            ('TD', 'TCD', 'تشاد', 'Chad', '🇹🇩', '+235', TRUE),
            ('UG', 'UGA', 'أوغندا', 'Uganda', '🇺🇬', '+256', TRUE),
            ('MR', 'MRT', 'موريتانيا', 'Mauritania', '🇲🇷', '+222', TRUE),
            ('DJ', 'DJI', 'جيبوتي', 'Djibouti', '🇩🇯', '+253', TRUE),
            ('KM', 'COM', 'جزر القمر', 'Comoros', '🇰🇲', '+269', TRUE)
        ON CONFLICT (code_alpha2) DO UPDATE SET is_active = TRUE;
        """
    )

    # ── 2. country_requirements (child). One row per country mapping it to its
    #    model. national_id_required carries each model's generic default
    #    (conflict/humanitarian FALSE, documented TRUE) — like PS (FALSE) /
    #    EG (TRUE) — because the resolver reads this column, not the profile, when
    #    a row exists. national_id_length / national_id_regex / phone_regex are
    #    left to their NULL defaults and required_documents to its '[]' default:
    #    per-country overrides come later. Upsert keyed on the unique country_code
    #    so a re-run converges each row to its model. ──
    op.execute(
        """
        INSERT INTO country_requirements
            (country_code, profile, national_id_required)
        VALUES
            ('SY', 'conflict', FALSE),
            ('YE', 'conflict', FALSE),
            ('SD', 'conflict', FALSE),
            ('JO', 'documented', TRUE),
            ('TN', 'documented', TRUE),
            ('TR', 'documented', TRUE),
            ('PK', 'documented', TRUE),
            ('BD', 'documented', TRUE),
            ('ID', 'documented', TRUE),
            ('LB', 'humanitarian', FALSE),
            ('ET', 'humanitarian', FALSE),
            ('KE', 'humanitarian', FALSE),
            ('TD', 'humanitarian', FALSE),
            ('UG', 'humanitarian', FALSE),
            ('MR', 'humanitarian', FALSE),
            ('DJ', 'humanitarian', FALSE),
            ('KM', 'humanitarian', FALSE)
        ON CONFLICT (country_code) DO UPDATE SET
            profile = EXCLUDED.profile,
            national_id_required = EXCLUDED.national_id_required,
            updated_at = NOW();
        """
    )


def downgrade() -> None:
    # Reverse in FK-safe order: child (country_requirements) before parent
    # (countries). All seventeen requirement rows were introduced here, so all
    # seventeen are removed (PS/EG untouched).
    op.execute(
        """
        DELETE FROM country_requirements
        WHERE country_code IN (
            'SY', 'YE', 'SD', 'JO', 'TN', 'TR', 'PK', 'BD', 'ID',
            'LB', 'ET', 'KE', 'TD', 'UG', 'MR', 'DJ', 'KM'
        );
        """
    )
    # From countries, remove ONLY the fourteen rows this migration introduced.
    # SY/YE/SD predate it (0001 canonical baseline) and may be FK-referenced by
    # existing data, so they are intentionally preserved — deleting them would
    # corrupt the baseline / break those FKs. PS/EG are not in scope either way.
    op.execute(
        """
        DELETE FROM countries
        WHERE code_alpha2 IN (
            'JO', 'TN', 'TR', 'PK', 'BD', 'ID',
            'LB', 'ET', 'KE', 'TD', 'UG', 'MR', 'DJ', 'KM'
        );
        """
    )
