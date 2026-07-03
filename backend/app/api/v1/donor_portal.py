"""Donor-facing read endpoints.

When a user with `role=donor` calls these routes, we look up the donor
row linked via users.id and scope every response to that donor. Other
roles (staff/admin) can pass an explicit donor_id query param so they
can preview a donor's view.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.api.v1.messages import MESSAGE_MAX_LEN, MessageRead, _project
from app.api.v1.public import to_public_detail
from app.core.exceptions import NotFound
from app.models.donor import Donor
from app.models.family import Family, Guardian
from app.models.media import Media
from app.models.message import Message
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.payment import Payment
from app.models.report import OrphanReport
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page
from app.schemas.media import CONSENT_REQUIRED_CATEGORIES, MediaCategory
from app.schemas.payment import PaymentDonorRead
from app.schemas.profile_visibility import ProfileElement, is_visible
from app.schemas.report import (
    ActivitiesSection,
    EducationProgress,
    HealthStatus,
    PsychologicalStatus,
    QuranProgress,
    ReportDonorRead,
)
from app.schemas.sponsored_profile import (
    DreamBlock,
    FatherMemory,
    GuardianBlock,
    HealthBlock,
    HerWorldBlock,
    HomeBlock,
    InHerWordsItem,
    MediaBlock,
    MediaItem,
    MilestoneItem,
    MilestonesBlock,
    MultidimGrowthBlock,
    NumberDelta,
    QuranGrowthBlock,
    QuranGrowthPoint,
    RecentUpdateItem,
    RecentUpdatesBlock,
    SinceYouBeganBlock,
    SponsoredOrphanProfile,
    SupervisorWordBlock,
    TextDelta,
)
from app.schemas.sponsorship import SponsorshipRead
from app.services.audit import record_audit
from app.services.storage import presigned_get_url_for

router = APIRouter()


def _visible_section[SectionT: BaseModel](
    raw: dict[str, Any] | None,
    key: str,
    visibility: dict[str, bool],
    model: type[SectionT],
) -> SectionT | None:
    """Parse a stored JSONB section into its typed model, but only when the
    supervisor left it visible. A section is shown UNLESS its key is explicitly
    ``False`` in ``section_visibility`` — so an empty map ⇒ everything visible.
    Hidden (or absent) sections collapse to ``None``.
    """
    if raw is None or visibility.get(key) is False:
        return None
    return model.model_validate(raw)


def _donor_report_view(report: OrphanReport) -> ReportDonorRead:
    """Project one report row into the donor-safe schema, dropping every section
    the supervisor hid. ``section_visibility`` is consumed here and never leaves
    the server.
    """
    vis = report.section_visibility or {}
    return ReportDonorRead.model_validate(
        {
            "id": report.id,
            "orphan_id": report.orphan_id,
            "report_type": report.report_type,
            "period_start": report.period_start,
            "period_end": report.period_end,
            "summary": report.summary,
            "donor_message": report.donor_message,
            "is_milestone": report.is_milestone,
            "milestone_label": report.milestone_label,
            "status": report.status,
            "submitted_at": report.submitted_at,
            "partner_approved_at": report.partner_approved_at,
            "org_approved_at": report.org_approved_at,
            "published_at": report.published_at,
            "photos_count": report.photos_count,
            "videos_count": report.videos_count,
            "documents_count": report.documents_count,
            "created_at": report.created_at,
            "updated_at": report.updated_at,
            "educational_progress": _visible_section(
                report.educational_progress, "education", vis, EducationProgress
            ),
            "quran_progress": _visible_section(report.quran_progress, "quran", vis, QuranProgress),
            "activities": _visible_section(report.activities, "activities", vis, ActivitiesSection),
            "health_status": _visible_section(report.health_status, "health", vis, HealthStatus),
            "psychological_status": _visible_section(
                report.psychological_status, "psychological", vis, PsychologicalStatus
            ),
        }
    )


async def _resolve_donor_id(db: AsyncSession, current_user: User, requested: UUID | None) -> UUID:
    """Determine which donor's data the caller is allowed to see.

    Donors are pinned to their own record; staff may pass donor_id.
    """
    if current_user.role == "donor":
        donor: Donor | None = await db.scalar(select(Donor).where(Donor.user_id == current_user.id))
        if donor is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Your account is not linked to a donor record",
            )
        if requested is not None and requested != donor.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Donors can only view their own data",
            )
        return donor.id

    if requested is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Non-donor callers must supply donor_id",
        )
    donor = await db.scalar(select(Donor).where(Donor.id == requested))
    if donor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Donor not found")
    return donor.id


async def _resolve_my_sponsorship(
    db: AsyncSession,
    user: User,
    orphan_id: UUID,
    donor_id: UUID | None,
    *,
    active_only: bool = False,
) -> Sponsorship:
    """Resolve + own-check the caller's sponsorship of ``orphan_id``.

    Mirrors the ``/sponsorships/{orphan_id}/profile`` convention: the path
    param is the ORPHAN id and we locate the donor's own sponsorship from it.
    A non-sponsored / foreign / soft-deleted orphan_id (or, when
    ``active_only``, a cancelled/ended sponsorship) 404s exactly like an
    unknown id, so existence never leaks. The ``Sponsorship.donor_id`` predicate
    is the hard ownership scope — the app's superuser DB connection bypasses
    RLS, so this filter (not RLS) is what keeps a donor to their own children.
    """
    did = await _resolve_donor_id(db, user, donor_id)
    stmt = (
        select(Sponsorship)
        .join(Orphan, Orphan.id == Sponsorship.orphan_id)
        .where(
            Sponsorship.orphan_id == orphan_id,
            Sponsorship.donor_id == did,
            Orphan.deleted_at.is_(None),
        )
        .order_by(Sponsorship.start_date.asc())
    )
    if active_only:
        stmt = stmt.where(Sponsorship.status == "active")
    sponsorship = await db.scalar(stmt)
    if sponsorship is None:
        raise NotFound("Orphan")
    return sponsorship


class SponsorshipMessageCreate(BaseModel):
    """Donor compose payload for the sponsorship-scoped archive (PR-9).

    Deliberately minimal: the body carries ONLY the text. Every routing field
    (recipient, orphan, sponsorship, organization) is SERVER-DERIVED from the
    resolved sponsorship — the donor never supplies a recipient or an orphan id.
    """

    content: str = Field(min_length=1, max_length=MESSAGE_MAX_LEN)
    message_type: Literal["text"] = "text"

    @field_validator("content")
    @classmethod
    def _trim_non_empty(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Message content cannot be empty")
        return trimmed


@router.get("/sponsorships", response_model=Page[SponsorshipRead])
async def my_sponsorships(
    db: DbSession,
    user: CurrentUser,
    donor_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[SponsorshipRead]:
    did = await _resolve_donor_id(db, user, donor_id)
    stmt = select(Sponsorship).where(Sponsorship.donor_id == did)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Sponsorship.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[SponsorshipRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def _text_delta(values: Sequence[str]) -> TextDelta | None:
    """First-vs-latest delta over an ordered (oldest→newest) list of text values.
    ``None`` when no report carried the value (so the block field is omitted)."""
    if not values:
        return None
    return TextDelta(first=values[0], latest=values[-1])


def _number_delta(values: Sequence[int]) -> NumberDelta | None:
    if not values:
        return None
    return NumberDelta(first=values[0], latest=values[-1])


async def _media_item(m: Media) -> MediaItem:
    """Project ONE qualifying media row into the donor-safe item. Exposes only
    the vetted slice — never the storage key, consent document, moderation
    internals, uploader or org. ``url``/``thumbnail_url`` are fresh presigned
    GETs; ``display_date`` falls back to the upload date."""
    return MediaItem(
        id=m.id,
        title=m.title,
        caption=m.description,
        display_date=m.display_date or m.created_at.date(),
        url=await presigned_get_url_for(m.file_url),
        thumbnail_url=(await presigned_get_url_for(m.thumbnail_url) if m.thumbnail_url else None),
        duration_seconds=m.duration_seconds,
        width=m.width,
        height=m.height,
    )


async def _build_media_block(
    db: AsyncSession, orphan_id: UUID, visibility: dict[str, bool]
) -> MediaBlock | None:
    """Assemble the donor-cleared ``media`` block for one sponsored child.

    Returns ``None`` — the whole block omitted — when the ``media`` element is
    hidden OR no item qualifies. An item qualifies ONLY when ALL hold, enforced
    here server-side so a hidden/un-consented/un-approved row never leaves the
    server:

    * it belongs to THIS orphan (the caller has already proven sponsorship);
    * ``moderation_status == 'approved'``;
    * ``visibility IN ('donor_only','public')``;
    * its category is not consent-gated, OR guardian consent is on record.

    Only the four donor-facing groups are surfaced (drawings/certificates/album/
    recitations); ``portrait`` is the identity photo and is never listed here.
    """
    if not is_visible(visibility, ProfileElement.media):
        return None

    rows = (
        await db.scalars(
            select(Media)
            .where(
                Media.orphan_id == orphan_id,
                Media.moderation_status == "approved",
                Media.visibility.in_(("donor_only", "public")),
            )
            .order_by(Media.created_at.desc())
        )
    ).all()

    groups: dict[str, list[MediaItem]] = {
        MediaCategory.drawing.value: [],
        MediaCategory.certificate.value: [],
        MediaCategory.album.value: [],
        MediaCategory.recitation.value: [],
    }
    for m in rows:
        if m.category not in groups:
            continue
        if m.category in CONSENT_REQUIRED_CATEGORIES and not m.has_guardian_consent:
            continue
        groups[m.category].append(await _media_item(m))

    if not any(groups.values()):
        return None
    return MediaBlock(
        drawings=groups[MediaCategory.drawing.value],
        certificates=groups[MediaCategory.certificate.value],
        album=groups[MediaCategory.album.value],
        recitations=groups[MediaCategory.recitation.value],
    )


async def _build_home_block(
    db: AsyncSession, orphan: Orphan, visibility: dict[str, bool]
) -> HomeBlock | None:
    """Assemble the donor-safe ``home`` block for one sponsored child.

    Returns ``None`` — the whole block omitted — when the ``home`` element is
    hidden, the child has no family on record, or neither allowlisted value is
    present. The family row is loaded with an EXPLICIT ``organization_id``
    filter (the app's superuser connection bypasses RLS, so this predicate —
    not RLS — is what keeps the read inside the orphan's org). Only the strict
    :class:`HomeBlock` allowlist leaves the server: the governorate (region at
    GOVERNORATE level, never finer) and the coded housing status. The exact
    address, income, notes and every other family field stay staff-only.
    """
    if not is_visible(visibility, ProfileElement.home) or orphan.family_id is None:
        return None
    family = await db.scalar(
        select(Family).where(
            Family.id == orphan.family_id,
            Family.organization_id == orphan.organization_id,
        )
    )
    if family is None or not (family.governorate or family.housing_status):
        return None
    return HomeBlock(governorate=family.governorate, housing_status=family.housing_status)


async def _build_guardian_block(
    db: AsyncSession, orphan: Orphan, visibility: dict[str, bool]
) -> GuardianBlock | None:
    """Assemble the donor-safe ``guardian`` block for one sponsored child.

    Returns ``None`` — the whole block omitted — when the ``guardian`` element
    is hidden, the child has no family on record, or the family has no
    guardian. Guardians are loaded with an EXPLICIT ``organization_id`` filter
    (the app's superuser connection bypasses RLS, so this predicate — not RLS —
    is what keeps the read inside the orphan's org). The primary caregiver is
    preferred by relation ("mother", then "grandmother"), else the first on
    record. Only the strict :class:`GuardianBlock` allowlist leaves the server:
    the coded relation + occupation. Names, ids, contact and banking details
    stay staff-only.
    """
    if not is_visible(visibility, ProfileElement.guardian) or orphan.family_id is None:
        return None
    guardians = (
        await db.scalars(
            select(Guardian)
            .where(
                Guardian.family_id == orphan.family_id,
                Guardian.organization_id == orphan.organization_id,
            )
            .order_by(Guardian.created_at.asc())
        )
    ).all()
    if not guardians:
        return None
    primary = next(
        (g for wanted in ("mother", "grandmother") for g in guardians if g.relation == wanted),
        guardians[0],
    )
    return GuardianBlock(relation=primary.relation, occupation=primary.occupation)


def _compose_sponsored_profile(
    orphan: Orphan,
    partner_name: str | None,
    reports: list[ReportDonorRead],
    sponsorship_start: date,
    media: MediaBlock | None = None,
    home: HomeBlock | None = None,
    guardian: GuardianBlock | None = None,
) -> SponsoredOrphanProfile:
    """Assemble the donor-safe profile from already-safe parts.

    ``reports`` are the donor-projected (``ReportDonorRead``) reports for this
    child, oldest→newest — each already stripped of the sections its supervisor
    hid, so deriving blocks from them can never leak a hidden section. Every
    element block is emitted ONLY when the element is visible per
    ``orphan.profile_visibility`` AND its underlying data exists; otherwise it
    stays ``None`` (omitted). ``profile_visibility`` never reaches the response.
    """
    vis = orphan.profile_visibility or {}
    # Identity/header: reuse the EXACT donor-safe slice — never re-derived here.
    detail = to_public_detail(orphan, partner_name)

    newest_first = list(reversed(reports))

    # dream ── the child's aspiration.
    dream = None
    if is_visible(vis, ProfileElement.dream) and orphan.aspiration:
        dream = DreamBlock(aspiration=orphan.aspiration)

    # her_world ── where the child is right now.
    her_world = None
    if is_visible(vis, ProfileElement.her_world) and (
        orphan.education_stage
        or orphan.tags
        or orphan.quran_juz_memorized is not None
        or orphan.current_juz is not None
    ):
        her_world = HerWorldBlock(
            education_stage=orphan.education_stage,
            tags=list(orphan.tags),
            quran_juz_memorized=orphan.quran_juz_memorized,
            current_juz=orphan.current_juz,
            is_hafiz=detail.is_hafiz,
        )

    # quran_growth ── juz' memorised over time (only reports whose quran section
    # is visible carry quran_progress, so hidden ones drop out naturally).
    quran_growth = None
    if is_visible(vis, ProfileElement.quran_growth):
        points = [
            QuranGrowthPoint(period=r.period_end, juz_memorized=r.quran_progress.juz_memorized)
            for r in reports
            if r.quran_progress is not None and r.quran_progress.juz_memorized is not None
        ]
        if points:
            quran_growth = QuranGrowthBlock(series=points)

    # multidim_growth ── first-vs-latest deltas across a few dimensions.
    multidim_growth = None
    if is_visible(vis, ProfileElement.multidim_growth):
        stages = [
            r.educational_progress.stage
            for r in reports
            if r.educational_progress is not None and r.educational_progress.stage is not None
        ]
        attendance = [
            r.educational_progress.attendance_percent
            for r in reports
            if r.educational_progress is not None
            and r.educational_progress.attendance_percent is not None
        ]
        social = [
            r.psychological_status.social
            for r in reports
            if r.psychological_status is not None and r.psychological_status.social is not None
        ]
        stage_delta = _text_delta(stages)
        attendance_delta = _number_delta(attendance)
        social_delta = _text_delta(social)
        if stage_delta or attendance_delta or social_delta:
            multidim_growth = MultidimGrowthBlock(
                education_stage=stage_delta,
                attendance_percent=attendance_delta,
                social=social_delta,
            )

    # milestones ── celebrated moments (newest first).
    milestones = None
    if is_visible(vis, ProfileElement.milestones):
        items = [
            MilestoneItem(label=r.milestone_label, period=r.period_end)
            for r in newest_first
            if r.is_milestone and r.milestone_label
        ]
        if items:
            milestones = MilestonesBlock(items=items)

    # recent_updates ── the latest few report headlines (newest first).
    recent_updates = None
    if is_visible(vis, ProfileElement.recent_updates):
        updates = [
            RecentUpdateItem(period=r.period_end, headline=r.summary)
            for r in newest_first
            if r.summary
        ][:3]
        if updates:
            recent_updates = RecentUpdatesBlock(items=updates)

    # supervisor_word ── the latest warm note from the supervisor.
    supervisor_word = None
    if is_visible(vis, ProfileElement.supervisor_word):
        latest = next((r for r in newest_first if r.donor_message), None)
        if latest is not None and latest.donor_message:
            supervisor_word = SupervisorWordBlock(
                text=latest.donor_message,
                period=latest.period_end,
                author_label=partner_name,
            )

    # since_you_began ── what changed since this donor's sponsorship began. The
    # sponsorship is guaranteed to exist (this endpoint is sponsorship-scoped).
    since_you_began = None
    if is_visible(vis, ProfileElement.since_you_began):
        juz_series = [
            r.quran_progress.juz_memorized
            for r in reports
            if r.quran_progress is not None and r.quran_progress.juz_memorized is not None
        ]
        juz_gained = max(juz_series[-1] - juz_series[0], 0) if juz_series else 0
        since_you_began = SinceYouBeganBlock(
            start_date=sponsorship_start,
            juz_gained=juz_gained,
            milestones_count=sum(1 for r in reports if r.is_milestone),
            reports_count=len(reports),
        )

    # in_her_words ── curated child phrases, in the child's own voice. The stored
    # ids/authoring data NEVER reach the donor — only text + said_on. Hidden OR
    # empty ⇒ the whole block stays None (omitted), mirroring every other element.
    in_her_words = None
    if is_visible(vis, ProfileElement.in_her_words) and orphan.in_her_words:
        in_her_words = [
            InHerWordsItem(text=item["text"], said_on=item.get("said_on"))
            for item in orphan.in_her_words
        ]

    # father_memory ── a dignified remembrance of the deceased father. DOUBLE
    # GATE: emitted ONLY when guardian consent is on record AND the supervisor
    # left the element visible AND the father's name exists. Exposes only the
    # name + the YEAR of death — the certificate and full date never leave the
    # server. Consent false OR visibility false ⇒ omitted (None).
    father_memory = None
    if (
        orphan.father_memory_consent
        and is_visible(vis, ProfileElement.father_memory)
        and orphan.father_name
    ):
        father_memory = FatherMemory(
            father_name=orphan.father_name,
            death_year=orphan.father_death_date.year if orphan.father_death_date else None,
        )

    # health ── a reassuring, non-clinical summary (the FIRST health data on
    # any donor surface). MINIMAL SLICE: the coded status_label + last_checkup
    # + coded vaccinations_status ONLY — chronic_conditions / health_coverage /
    # challenges never reach this block. Gated exactly like the sibling
    # elements: hidden OR no underlying value ⇒ omitted (None).
    health = None
    if is_visible(vis, ProfileElement.health) and (
        orphan.health_status is not None
        or orphan.last_checkup is not None
        or orphan.vaccinations_status is not None
    ):
        health = HealthBlock.model_validate(
            {
                "status_label": orphan.health_status,
                "last_checkup": orphan.last_checkup,
                "vaccinations_status": orphan.vaccinations_status,
            }
        )

    return SponsoredOrphanProfile(
        first_name=detail.first_name,
        age_years=detail.age_years,
        gender=detail.gender,
        country=detail.country,
        partner_organization_name=detail.partner_organization_name,
        aspiration=detail.aspiration,
        education_stage=detail.education_stage,
        quran_juz_memorized=detail.quran_juz_memorized,
        tags=detail.tags,
        is_hafiz=detail.is_hafiz,
        languages=detail.languages,
        orphan_status=detail.orphan_status,
        dream=dream,
        her_world=her_world,
        quran_growth=quran_growth,
        multidim_growth=multidim_growth,
        milestones=milestones,
        recent_updates=recent_updates,
        supervisor_word=supervisor_word,
        since_you_began=since_you_began,
        media=media,
        in_her_words=in_her_words,
        father_memory=father_memory,
        health=health,
        home=home,
        guardian=guardian,
    )


@router.get("/sponsorships/{orphan_id}/profile", response_model=SponsoredOrphanProfile)
async def my_sponsored_orphan_profile(
    db: DbSession,
    user: CurrentUser,
    orphan_id: UUID,
    donor_id: Annotated[UUID | None, Query()] = None,
) -> SponsoredOrphanProfile:
    """The donor-safe humanizing profile of a child this donor sponsors.

    Unlike the public browse endpoint, scoping here is by an actual
    Sponsorship row (this donor → this orphan), NOT by ``case_status`` —
    so a sponsored child (case_status='sponsored', no longer browseable)
    still resolves. A child the donor does not sponsor 404s exactly like
    an unknown id, so existence never leaks.

    The response is COMPOSED from already-donor-safe parts: the identity slice
    reuses ``to_public_detail`` (the canonical ``PublicOrphanDetail`` contract),
    and each element block is assembled from the same donor-projected reports
    that back ``/me/reports``. An element the supervisor hid via
    ``orphan.profile_visibility`` is OMITTED here — a hidden element never leaves
    the server — and the visibility map itself is never serialised.
    """
    did = await _resolve_donor_id(db, user, donor_id)
    row = (
        await db.execute(
            select(Orphan, PartnerOrganization.name_ar, func.min(Sponsorship.start_date))
            .join(Sponsorship, Sponsorship.orphan_id == Orphan.id)
            .outerjoin(
                PartnerOrganization,
                PartnerOrganization.id == Orphan.partner_organization_id,
            )
            .where(
                Orphan.id == orphan_id,
                Orphan.deleted_at.is_(None),
                Sponsorship.donor_id == did,
            )
            .group_by(Orphan.id, PartnerOrganization.name_ar)
        )
    ).first()
    if row is None:
        raise NotFound("Orphan")
    orphan, partner_name, sponsorship_start = row

    # Same donor-scoped, donor-safe reports that back /me/reports — projected
    # through each report's own section_visibility, oldest→newest for the series.
    report_rows = (
        await db.scalars(
            select(OrphanReport)
            .where(
                OrphanReport.orphan_id == orphan_id,
                OrphanReport.status == "published_to_donor",
            )
            .order_by(OrphanReport.period_end.asc(), OrphanReport.published_at.asc())
        )
    ).all()
    reports = [_donor_report_view(r) for r in report_rows]

    vis = orphan.profile_visibility or {}
    media = await _build_media_block(db, orphan_id, vis)
    home = await _build_home_block(db, orphan, vis)
    guardian = await _build_guardian_block(db, orphan, vis)
    return _compose_sponsored_profile(
        orphan, partner_name, reports, sponsorship_start, media, home, guardian
    )


# ── Sponsorship-scoped message archive (PR-9: أرشيف رسائلك إليها) ──────────
#
# The donor's OWN thread of messages to a child they sponsor, scoped to one
# sponsorship. Every routing field is server-derived from the resolved
# sponsorship — the donor never names a recipient or an orphan in the body.
# The wire shape + the PII-omitting projection (`_project`) are reused from the
# generic messages router so no user ids / emails / last names ever leak.


@router.post(
    "/sponsorships/{orphan_id}/messages",
    response_model=MessageRead,
    status_code=status.HTTP_201_CREATED,
)
async def send_sponsorship_message(
    db: DbSession,
    user: CurrentUser,
    orphan_id: UUID,
    payload: SponsorshipMessageCreate,
) -> MessageRead:
    """Donor sends a message to the child they sponsor.

    The message lands ``pending`` with NO recipient (``to_user_id`` NULL): the
    orphanage routes/relays it on approval. Org + sponsorship are derived from
    the resolved sponsorship, never from the body. A child the donor does not
    actively sponsor 404s without revealing whether it exists.
    """
    if user.role != "donor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only donors can send messages here",
        )
    sponsorship = await _resolve_my_sponsorship(db, user, orphan_id, None, active_only=True)

    msg = Message(
        organization_id=sponsorship.organization_id,
        from_user_id=user.id,
        to_user_id=None,  # the orphanage routes/relays on approval
        related_orphan_id=orphan_id,
        related_sponsorship_id=sponsorship.id,
        message_type="text",
        content=payload.content,
        moderation_status="pending",
    )
    db.add(msg)
    await db.flush()
    record_audit(
        db,
        organization_id=sponsorship.organization_id,
        user_id=user.id,
        action="message.sent",
        entity_type="message",
        entity_id=msg.id,
        new_values={
            "related_orphan_id": str(orphan_id),
            "related_sponsorship_id": str(sponsorship.id),
            "message_type": "text",
        },
    )
    await db.commit()
    await db.refresh(msg)
    return await _project(msg, user, db)


@router.get("/sponsorships/{orphan_id}/messages", response_model=Page[MessageRead])
async def list_sponsorship_messages(
    db: DbSession,
    user: CurrentUser,
    orphan_id: UUID,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[MessageRead]:
    """The donor's own archive of messages to one sponsored child.

    Returns every message the caller sent about ``orphan_id`` — ALL statuses
    (pending / approved / rejected), newest-first — so the sender always knows
    where each note stands. Projected through ``_project`` so a rejected message
    still carries its moderation note to the sender, and no internal ids leak.
    The ``from_user_id == user.id`` predicate is the hard ownership scope.
    """
    await _resolve_my_sponsorship(db, user, orphan_id, None)

    stmt = select(Message).where(
        Message.from_user_id == user.id,
        Message.related_orphan_id == orphan_id,
    )
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Message.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[await _project(m, user, db) for m in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/reports", response_model=Page[ReportDonorRead])
async def my_reports(
    db: DbSession,
    user: CurrentUser,
    donor_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ReportDonorRead]:
    """Reports for every orphan this donor sponsors — only the ones that
    have actually been published to donors. Each report is projected through
    its ``section_visibility`` so hidden sections never reach the donor."""
    did = await _resolve_donor_id(db, user, donor_id)
    sub = select(Sponsorship.orphan_id).where(Sponsorship.donor_id == did)
    stmt = select(OrphanReport).where(
        OrphanReport.orphan_id.in_(sub),
        OrphanReport.status == "published_to_donor",
    )
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(
            stmt.order_by(OrphanReport.published_at.desc()).limit(limit).offset(offset)
        )
    ).all()
    return Page(
        items=[_donor_report_view(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def _donor_payment_view(p: Payment) -> PaymentDonorRead:
    # from_attributes reads only the declared donor-safe fields; nothing else leaves the server
    return PaymentDonorRead.model_validate(p)


@router.get("/payments", response_model=Page[PaymentDonorRead])
async def my_payments(
    db: DbSession,
    user: CurrentUser,
    orphan_id: Annotated[UUID | None, Query()] = None,
    donor_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[PaymentDonorRead]:
    """Every payment the calling donor made — optionally narrowed to one
    sponsored child. Hard-scoped to the donor's own payments."""
    did = await _resolve_donor_id(db, user, donor_id)
    stmt = select(Payment).where(Payment.donor_id == did)
    if orphan_id is not None:
        # defense in depth: only orphans this donor actually sponsors
        sponsored = select(Sponsorship.orphan_id).where(Sponsorship.donor_id == did)
        stmt = stmt.where(Payment.orphan_id == orphan_id, Payment.orphan_id.in_(sponsored))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = func.coalesce(Payment.completed_at, Payment.failed_at, Payment.initiated_at).desc()
    rows = (await db.scalars(stmt.order_by(order).limit(limit).offset(offset))).all()
    return Page(
        items=[_donor_payment_view(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
