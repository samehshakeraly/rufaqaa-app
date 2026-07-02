from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Integer,
    LargeBinary,
    Numeric,
    SmallInteger,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Orphan(Base):
    __tablename__ = "orphans"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    partner_organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("partner_organizations.id"), nullable=False
    )
    family_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("families.id"))
    orphanage_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("orphanages.id")
    )
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), unique=True
    )

    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)

    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    middle_name: Mapped[str | None] = mapped_column(String(100))
    family_name: Mapped[str] = mapped_column(String(100), nullable=False)
    full_name_en: Mapped[str | None] = mapped_column(String(255))

    date_of_birth: Mapped[date] = mapped_column(Date, nullable=False)
    gender: Mapped[str] = mapped_column(String(1), nullable=False)
    nationality: Mapped[str | None] = mapped_column(String(2))

    birth_certificate_number: Mapped[str | None] = mapped_column(String(100))

    father_name: Mapped[str | None] = mapped_column(String(255))
    father_death_date: Mapped[date | None] = mapped_column(Date)
    father_death_certificate: Mapped[str | None] = mapped_column(String(100))
    # Gates donor disclosure of the father's memory (see migration 0026). The
    # donor-facing block (father's name + YEAR of death) is exposed ONLY when
    # this guardian consent is on record AND the supervisor left the
    # ``father_memory`` element visible — default hidden until explicitly
    # consented. The death certificate / full date never leave the server.
    father_memory_consent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )

    # Richer registration intake (see migration 0021). ``lives_with`` is
    # enum-coded and validated only in the Pydantic layer (no DB CHECK), the
    # same pattern as the education_stage/academic_level fields below.
    mother_name: Mapped[str | None] = mapped_column(String(255))
    lives_with: Mapped[str | None] = mapped_column(String(20))

    # Optional profile enrichment (see migration 0008). Enum-coded fields are
    # validated in the Pydantic layer, not the DB.
    education_stage: Mapped[str | None] = mapped_column(String(30))
    academic_level: Mapped[str | None] = mapped_column(String(50))
    school_name: Mapped[str | None] = mapped_column(String(255))
    quran_juz_memorized: Mapped[int | None] = mapped_column(SmallInteger)
    quran_note: Mapped[str | None] = mapped_column(Text)
    health_status: Mapped[str | None] = mapped_column(String(20))
    health_coverage: Mapped[str | None] = mapped_column(String(20))
    chronic_conditions: Mapped[str | None] = mapped_column(Text)
    aspiration: Mapped[str | None] = mapped_column(Text)
    challenges: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]"), default=list
    )

    # Small identity fields (see migration 0027). ``languages`` mirrors the
    # ``tags`` array pattern; ``current_juz`` is the juz' the child is
    # currently memorising (1–30, validated in Pydantic only — no DB CHECK,
    # like quran_juz_memorized above). The donor-facing ``orphan_status``
    # (father/both) is deliberately NOT stored — it is derived from
    # ``mother_status`` at read time (0016 dropped ``parental_status``).
    languages: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]"), default=list
    )
    current_juz: Mapped[int | None] = mapped_column(SmallInteger)

    # Static health fields (see migration 0028). ``vaccinations_status`` is
    # coded and validated in the Pydantic layer only (no DB CHECK — mirrors
    # health_status above). Together with the coded ``health_status`` these
    # back the gated donor ``health`` element — the deliberately minimal slice;
    # ``health_coverage`` / ``chronic_conditions`` / ``challenges`` stay
    # staff-only and never reach any donor surface.
    last_checkup: Mapped[date | None] = mapped_column(Date)
    vaccinations_status: Mapped[str | None] = mapped_column(String(20))

    case_status: Mapped[str] = mapped_column(String(30), default="pending_review")

    # Per-element donor-profile visibility (see migration 0023). A JSONB map
    # keyed by ProfileElement (see app.schemas.profile_visibility); an element is
    # shown to donors UNLESS its key is explicitly ``False``, so an empty map ⇒
    # everything visible (the product default — mirrors the report
    # ``section_visibility`` pattern). The identity/header block is implicit and
    # always shown; it is never a key here. WRITE path: staff
    # GET/PUT /orphans/{id}/profile-visibility. READ path: the donor profile
    # composition consumes it server-side — it NEVER leaves the server.
    profile_visibility: Mapped[dict[str, bool]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb"), default=dict
    )

    # Curated "In Her Words" (بكلماتها) phrases (see migration 0025). An ordered
    # JSONB list of supervisor-authored child phrases shown on the donor profile;
    # each item is ``{"id": <uuid>, "text": <str>, "said_on": <ISO date|null>}``
    # and the array order IS the display order. Governed by the per-element
    # visibility map (ProfileElement.in_her_words) and, like every other element,
    # stripped server-side when hidden. The donor projection exposes ONLY
    # ``text`` + ``said_on`` — the internal id never leaves the server. WRITE
    # path: staff GET/PUT /orphans/{id}/in-her-words (replace semantics).
    in_her_words: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb"), default=list
    )

    # Orphan browsing foundation (see migration 0009). ``available_since`` is
    # stamped the first time a child enters the available pool and is never
    # overwritten (see app.services.orphans.stamp_available_since). The two
    # coded columns are NOT NULL with DB-level CHECK constraints.
    available_since: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    mother_status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'unknown'"), default="unknown"
    )
    priority_level: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'normal'"), default="normal"
    )

    # Country-aware registration (see migration 0014). ``national_id`` is
    # encrypted at rest into ``national_id_encrypted`` (BYTEA Fernet token) by
    # the write path (see app.core.crypto / services.orphans); the original
    # plaintext column was dropped in 0020 once encryption fully replaced it. The
    # ciphertext is NEVER serialised — orphan national_id is write-only (not in
    # any read schema). ``country_specific`` holds the per-country intake answers
    # as a JSONB bag.
    national_id_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary)
    country_specific: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb"), default=dict
    )
    # Deterministic HMAC-SHA256 of the normalised national_id (see
    # app.core.crypto.national_id_blind_index and migration 0021). Like
    # national_id itself it is WRITE-ONLY — never serialised in any read schema —
    # but, unlike the per-write-randomised ciphertext above, it is deterministic,
    # so it backs the per-org partial-unique ``uq_orphans_national_id_per_org``:
    # the same id cannot be registered twice in one organization even though
    # every Fernet token differs. The derived HMAC key MUST stay stable.
    national_id_blind_index: Mapped[bytes | None] = mapped_column(LargeBinary)

    assigned_to_channel_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("marketing_channels.id")
    )
    assigned_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    assignment_deadline: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))

    approved_by_partner_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    approved_by_partner_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text)

    is_sponsored: Mapped[bool] = mapped_column(Boolean, default=False)
    current_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    balance_currency: Mapped[str | None] = mapped_column(String(3))

    profile_completion_percentage: Mapped[int] = mapped_column(Integer, default=0)
    profile_completion_score: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"))
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
