import csv
import io
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal, Protocol
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import Select, and_, case, false, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession
from app.api.scoping import get_in_org_or_404
from app.api.v1.users import _assert_partner_org_in_org
from app.core.authz import (
    ADMIN_ROLES,
    PARTNER_SCOPED_ROLES,
    STAFF_ROLES,
    partner_scope_hides,
    require_roles,
)
from app.core.constants import FILE_INCOMPLETE_THRESHOLD, REPORT_OVERDUE_GRACE_DAYS
from app.core.exceptions import NotFound
from app.core.reporting import due_status_cutoffs, effective_cadence
from app.models.family import Family
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.orphanage import Orphanage
from app.models.partner import MarketingChannel, PartnerOrganization
from app.models.payment import Payment
from app.models.report import OrphanReport
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page
from app.schemas.orphan import (
    EducationStage,
    HealthStatus,
    OrphanCreate,
    OrphanNameMatch,
    OrphanRead,
    OrphanSort,
    OrphanUpdate,
    PriorityLevel,
)
from app.schemas.profile_visibility import (
    ProfileElement,
    ProfileElementState,
    ProfileVisibilityRegistry,
    ProfileVisibilityUpdate,
    is_visible,
)
from app.schemas.sponsored_profile import (
    IN_HER_WORDS_MAX_ITEMS,
    FatherMemoryConsent,
    InHerWordsItemUpdate,
    InHerWordsList,
    InHerWordsStaffItem,
)
from app.schemas.timeline import Timeline, TimelineEvent
from app.services.audit import record_audit
from app.services.orphans import (
    _assert_orphanage_in_org,
    _assert_orphanage_in_partner_org,
    create_orphan_record,
    find_name_matches,
    recompute_profile_completion,
    stamp_available_since,
)

router = APIRouter()


def _apply_orphan_filters[SelectT: Select[Any]](
    stmt: SelectT,
    user: User,
    *,
    case_status: str | None = None,
    channel_id: UUID | None = None,
    assignment_status: Literal["active", "expired", "all"] = "all",
    education_stage: EducationStage | None = None,
    health_status: HealthStatus | None = None,
    is_hafiz: bool | None = None,
    min_juz: int | None = None,
    tags: list[str] | None = None,
    tags_mode: Literal["all", "any"] = "all",
    orphan_type: Literal["single", "double"] | None = None,
    priority: PriorityLevel | None = None,
    min_waiting_days: int | None = None,
    min_completion: int | None = None,
    q: str | None = None,
) -> SelectT:
    """Apply the staff orphan scoping + every list filter to ``stmt``.

    Single source of truth for the WHERE semantics shared by
    :func:`list_orphans` and :func:`orphan_segments` — the segments report is
    "the filtered list, grouped by a dimension", so the filter semantics of
    the two endpoints must never drift apart. ``stmt`` may select anything
    (whole rows, GROUP BY aggregates) as long as ``orphans`` is in its FROM
    clause; this helper only adds WHERE criteria.

    Scoping (explicit, never via RLS — the app's superuser connection
    bypasses RLS): non-deleted rows in the caller's organization, and for the
    partner-scoped roles (partner_manager / partner_staff) only the caller's
    own جهة — a scoped user with no جهة set sees nothing. Applied here so
    every consumer (list, count, aggregate) is tenant-safe by construction.
    """
    stmt = stmt.where(
        Orphan.deleted_at.is_(None),
        Orphan.organization_id == user.organization_id,
    )
    if user.role in PARTNER_SCOPED_ROLES:
        if user.partner_organization_id is None:
            stmt = stmt.where(false())
        else:
            stmt = stmt.where(Orphan.partner_organization_id == user.partner_organization_id)
    if case_status:
        stmt = stmt.where(Orphan.case_status == case_status)
    if channel_id:
        stmt = stmt.where(Orphan.assigned_to_channel_id == channel_id)
    if assignment_status == "active":
        stmt = stmt.where(Orphan.assignment_deadline >= datetime.now(UTC))
    elif assignment_status == "expired":
        stmt = stmt.where(Orphan.assignment_deadline < datetime.now(UTC))
    if education_stage:
        stmt = stmt.where(Orphan.education_stage == education_stage)
    if health_status:
        stmt = stmt.where(Orphan.health_status == health_status)
    if is_hafiz is not None:
        # is_hafiz is defined as quran_juz_memorized == 30 (mirror schema/public).
        # IS DISTINCT FROM treats NULL as "not a hafiz" for the negative case.
        stmt = stmt.where(
            Orphan.quran_juz_memorized == 30
            if is_hafiz
            else Orphan.quran_juz_memorized.is_distinct_from(30)
        )
    if min_juz is not None:
        stmt = stmt.where(Orphan.quran_juz_memorized >= min_juz)
    if tags:
        # tags is ARRAY(Text): @> ("all" — every tag present) vs && ("any" — overlap).
        stmt = stmt.where(
            Orphan.tags.contains(tags) if tags_mode == "all" else Orphan.tags.overlap(tags)
        )
    if orphan_type == "single":
        # Father lost, mother alive. "unknown" mother_status has no explicit
        # value and surfaces only when orphan_type is omitted.
        stmt = stmt.where(Orphan.mother_status == "alive")
    elif orphan_type == "double":
        stmt = stmt.where(Orphan.mother_status == "deceased")
    if priority:
        stmt = stmt.where(Orphan.priority_level == priority)
    if min_waiting_days is not None:
        # Minimum days in the available pool. Rows that never entered it
        # (available_since NULL) can't satisfy a waiting bound, so exclude them.
        cutoff = datetime.now(UTC) - timedelta(days=min_waiting_days)
        stmt = stmt.where(Orphan.available_since.is_not(None), Orphan.available_since <= cutoff)
    if min_completion is not None:
        stmt = stmt.where(Orphan.profile_completion_percentage >= min_completion)
    if q:
        # plainto_tsquery treats input as raw text and handles tokenisation,
        # which is safer than letting users craft tsquery operators. This WHERE
        # clause always applies; only the ORDER BY reacts to `sort`.
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                text("search_vector @@ plainto_tsquery('simple', :q)").bindparams(q=q),
                Orphan.code.ilike(like),
                Orphan.first_name.ilike(like),
                Orphan.family_name.ilike(like),
            )
        )
    return stmt


def _resolve_order_by(sort: OrphanSort | None, q: str | None) -> list[Any]:
    """Pick the ORDER BY for the staff orphan list, by precedence:

    1. an explicit ``sort`` wins (even when ``q`` is present), then
    2. relevance ordering when a search term ``q`` is supplied, else
    3. newest first.

    Every branch appends ``Orphan.id`` ascending as a final, stable tiebreaker
    so offset pagination stays deterministic across pages.
    """
    tiebreaker = Orphan.id.asc()
    if sort is not None:
        if sort == "recently_available":
            return [Orphan.available_since.desc().nulls_last(), tiebreaker]
        if sort == "longest_waiting":
            # Earliest into the available pool = waiting longest.
            return [Orphan.available_since.asc().nulls_last(), tiebreaker]
        if sort == "priority":
            priority_rank = case(
                (Orphan.priority_level == "urgent", 3),
                (Orphan.priority_level == "high", 2),
                else_=1,
            )
            return [
                priority_rank.desc(),
                Orphan.available_since.desc().nulls_last(),
                tiebreaker,
            ]
        if sort == "most_complete":
            return [Orphan.profile_completion_percentage.desc(), tiebreaker]
        # sort == "newest"
        return [Orphan.created_at.desc(), tiebreaker]
    if q:
        # Best full-text matches first when a query was supplied.
        return [
            text("ts_rank(search_vector, plainto_tsquery('simple', :q)) DESC").bindparams(q=q),
            Orphan.created_at.desc(),
            tiebreaker,
        ]
    return [Orphan.created_at.desc(), tiebreaker]


@router.get("", response_model=Page[OrphanRead])
async def list_orphans(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    case_status: str | None = None,
    channel_id: UUID | None = None,
    assignment_status: Literal["active", "expired", "all"] = "all",
    education_stage: EducationStage | None = None,
    health_status: HealthStatus | None = None,
    is_hafiz: bool | None = None,
    min_juz: Annotated[int | None, Query(ge=0, le=30)] = None,
    tags: Annotated[list[str] | None, Query()] = None,
    tags_mode: Literal["all", "any"] = "all",
    orphan_type: Literal["single", "double"] | None = None,
    priority: PriorityLevel | None = None,
    min_waiting_days: Annotated[int | None, Query(ge=0)] = None,
    min_completion: Annotated[int | None, Query(ge=0, le=100)] = None,
    q: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    sort: OrphanSort | None = None,
) -> Page[OrphanRead]:
    """List orphans, optionally filtered by case_status and a search term.

    `q` does a Postgres full-text search against the trigger-maintained
    `search_vector` (covers Arabic + English name fields and the code) and
    also matches the code prefix directly so partial codes like "ORF-AB"
    still work.

    `channel_id` narrows to orphans assigned to a marketing channel.
    `assignment_status` filters by assignment deadline: "active" keeps
    orphans whose deadline is still in the future, "expired" those past it,
    "all" applies no deadline filter.

    Segment filters (org-scoped staff surface only; `health_status` is a
    sensitive field never exposed on the public/donor surfaces):
    `education_stage` and `health_status` match the coded column exactly.
    `is_hafiz` is derived from `quran_juz_memorized` (== 30 when true; any
    other value, including NULL, when false). `min_juz` keeps orphans who
    have memorised at least that many juz'. `tags` filters on the tag array:
    `tags_mode="all"` requires every supplied tag (`@>`), `"any"` matches
    orphans sharing at least one (`&&`).

    Advanced filters (staff surface): `orphan_type` is derived from
    `mother_status` — "single" keeps father-only orphans (mother alive),
    "double" keeps double orphans (mother deceased). There is no explicit
    value for an unknown mother status, so those orphans surface only when
    `orphan_type` is omitted. `priority` matches `priority_level` exactly.
    `min_waiting_days` keeps orphans that have spent at least that many days
    in the available pool (rows with a NULL `available_since` are excluded).
    `min_completion` keeps orphans whose `profile_completion_percentage` is at
    least the supplied value (0–100).

    `sort` orders the result set. When omitted, ordering is automatic:
    relevance (ts_rank) while a `q` search term is present, otherwise newest
    first. Passing `sort` explicitly always wins — it overrides relevance even
    when `q` is supplied (the `q` text-match WHERE clause still applies). See
    :func:`_resolve_order_by` for each option's ORDER BY.
    """
    # Org + partner scoping and every filter live in _apply_orphan_filters,
    # shared verbatim with GET /orphans/segments. Applied before the count so
    # pagination matches.
    stmt = _apply_orphan_filters(
        select(Orphan),
        user,
        case_status=case_status,
        channel_id=channel_id,
        assignment_status=assignment_status,
        education_stage=education_stage,
        health_status=health_status,
        is_hafiz=is_hafiz,
        min_juz=min_juz,
        tags=tags,
        tags_mode=tags_mode,
        orphan_type=orphan_type,
        priority=priority,
        min_waiting_days=min_waiting_days,
        min_completion=min_completion,
        q=q,
    )
    stmt = stmt.order_by(*_resolve_order_by(sort, q))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (await db.scalars(stmt.limit(limit).offset(offset))).all()

    return Page(
        items=[OrphanRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


# ── Segments report (GET /orphans/segments) ─────────────────────────────
#
# Read-only aggregate over the SAME filtered slice as list_orphans: orphan
# counts grouped by one dimension. Output is counts only — it never returns
# an individual orphan row, zero PII. Staff surface only: health_status and
# any geographic dimension must never appear on donor/public surfaces.

# Dimensions the report can group by. Coded dimensions group directly on an
# orphans column; derived dimensions on a SQL CASE over one; joined dimensions
# on a foreign key (bucket key = the id) with a display name from the joined
# table. "governorate" is the HOUSE (dar) governorate — deliberately
# governorate-level only, never city/district, per the child-data rule.
SegmentDimension = Literal[
    "case_status",
    "education_stage",
    "health_status",
    "gender",
    "priority",
    "lives_with",
    "orphan_type",
    "hafiz",
    "juz_band",
    "age_band",
    "orphanage",
    "partner",
    "channel",
    "governorate",
]

# k-anonymity floor, applied to the SENSITIVE high-cardinality dimensions ONLY
# (governorate, orphanage): any bucket with fewer than SEGMENT_MIN_BUCKET
# orphans is collapsed into a single "other" bucket, so a rare location can
# never single out a child. The low-cardinality coded dimensions are exempt —
# their vocabularies are small, fixed and carry no location. Setting the
# constant to 1 (or emptying the dimension set) disables the collapse.
SEGMENT_MIN_BUCKET = 3
_SENSITIVE_SEGMENT_DIMENSIONS: frozenset[str] = frozenset({"governorate", "orphanage"})


class SegmentBucket(BaseModel):
    key: str  # coded value, or the id for joined dims
    label: str | None  # display name for joined dims; None for coded (frontend i18n-maps)
    count: int


class OrphanSegments(BaseModel):
    dimension: str
    total: int
    buckets: list[SegmentBucket]


def _segment_grouping(by: SegmentDimension) -> tuple[Any, Any, tuple[Any, Any] | None]:
    """The pieces of the GROUP BY for one dimension: ``(key_expr, label_expr,
    join)``.

    ``key_expr`` becomes the bucket key (NULL ⇒ the "unspecified" bucket),
    ``label_expr`` the display label for joined dimensions (None for coded
    ones — the frontend i18n-maps those keys), and ``join`` an optional
    ``(target, onclause)`` pair OUTER-joined so orphans without the related
    row are never dropped from the report."""
    if by == "case_status":
        return Orphan.case_status, None, None
    if by == "education_stage":
        return Orphan.education_stage, None, None
    if by == "health_status":
        return Orphan.health_status, None, None
    if by == "gender":
        return Orphan.gender, None, None
    if by == "priority":
        return Orphan.priority_level, None, None
    if by == "lives_with":
        return Orphan.lives_with, None, None
    if by == "orphan_type":
        # Derived from mother_status (the father is always deceased): mother
        # alive ⇒ paternal ("single") orphan, deceased ⇒ "double" orphan.
        # Mirrors the orphan_type filter, which has no "unknown" value.
        key = case(
            (Orphan.mother_status == "alive", "single"),
            (Orphan.mother_status == "deceased", "double"),
            else_="unknown",
        )
        return key, None, None
    if by == "hafiz":
        # Same definition as the is_hafiz filter: all 30 juz' memorised.
        # NULL falls into the CASE else ⇒ "no", matching IS DISTINCT FROM 30.
        return case((Orphan.quran_juz_memorized == 30, "yes"), else_="no"), None, None
    if by == "juz_band":
        # NULL is banded with 0: "nothing recorded" and "none memorised" are
        # the same band for reporting purposes.
        key = case(
            (func.coalesce(Orphan.quran_juz_memorized, 0) == 0, "0"),
            (Orphan.quran_juz_memorized <= 9, "1-9"),
            (Orphan.quran_juz_memorized <= 19, "10-19"),
            (Orphan.quran_juz_memorized <= 29, "20-29"),
            else_="30",
        )
        return key, None, None
    if by == "age_band":
        # Whole years as of today, computed in-query (date_of_birth is NOT
        # NULL, so every orphan lands in exactly one band).
        age_years = func.date_part("year", func.age(Orphan.date_of_birth))
        key = case(
            (age_years <= 5, "0-5"),
            (age_years <= 11, "6-11"),
            (age_years <= 14, "12-14"),
            (age_years <= 17, "15-17"),
            else_="18+",
        )
        return key, None, None
    if by == "orphanage":
        return (
            Orphan.orphanage_id,
            Orphanage.name_ar,
            (Orphanage, Orphan.orphanage_id == Orphanage.id),
        )
    if by == "partner":
        return (
            Orphan.partner_organization_id,
            PartnerOrganization.name_ar,
            (PartnerOrganization, Orphan.partner_organization_id == PartnerOrganization.id),
        )
    if by == "channel":
        return (
            Orphan.assigned_to_channel_id,
            MarketingChannel.name_ar,
            (MarketingChannel, Orphan.assigned_to_channel_id == MarketingChannel.id),
        )
    # by == "governorate" — the HOUSE governorate via the dar (never the
    # family address, and never city/district). The name is both the key and
    # its own display label.
    return (
        Orphanage.governorate,
        Orphanage.governorate,
        (Orphanage, Orphan.orphanage_id == Orphanage.id),
    )


class _CountedBucket(Protocol):
    count: int


def _collapse_small_buckets[BucketT: _CountedBucket](
    buckets: list[BucketT],
    make_other: Callable[[list[BucketT]], BucketT],
    *,
    exempt: Callable[[BucketT], bool] | None = None,
) -> list[BucketT]:
    """Fold every bucket below the k-anonymity floor into one "other" bucket.

    Counts move, they never disappear — the report total stays equal to the
    filtered orphan count. Generic over the bucket model so a report can carry
    extra tallies through the collapse: ``make_other`` builds the merged
    bucket from the small ones (summing whatever fields the model has), and
    ``exempt`` marks buckets that must never merge regardless of size (the
    community report keeps "unspecified" apart from "other" — "no governorate
    recorded" and "governorates too small to show" mean different things)."""

    def is_small(b: BucketT) -> bool:
        return b.count < SEGMENT_MIN_BUCKET and (exempt is None or not exempt(b))

    kept = [b for b in buckets if not is_small(b)]
    small = [b for b in buckets if is_small(b)]
    if small:
        kept.append(make_other(small))
    return kept


def _breakdown_buckets(rows: list[Any]) -> list[SegmentBucket]:
    """(key, count) GROUP BY rows → SegmentBuckets, NULL keyed 'unspecified',
    ordered by count descending with a stable tiebreak on key (the exact
    /orphans/segments contract, so the frontend renders both the same way)."""
    buckets = [
        SegmentBucket(
            key="unspecified" if row[0] is None else str(row[0]),
            label=None,
            count=int(row[1]),
        )
        for row in rows
    ]
    buckets.sort(key=lambda b: (-b.count, b.key))
    return buckets


@router.get("/segments", response_model=OrphanSegments)
async def orphan_segments(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    by: SegmentDimension,
    case_status: str | None = None,
    channel_id: UUID | None = None,
    assignment_status: Literal["active", "expired", "all"] = "all",
    education_stage: EducationStage | None = None,
    health_status: HealthStatus | None = None,
    is_hafiz: bool | None = None,
    min_juz: Annotated[int | None, Query(ge=0, le=30)] = None,
    tags: Annotated[list[str] | None, Query()] = None,
    tags_mode: Literal["all", "any"] = "all",
    orphan_type: Literal["single", "double"] | None = None,
    priority: PriorityLevel | None = None,
    min_waiting_days: Annotated[int | None, Query(ge=0)] = None,
    min_completion: Annotated[int | None, Query(ge=0, le=100)] = None,
    q: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
) -> OrphanSegments:
    """Aggregate "orphan segments" report: counts grouped by ``by``.

    Accepts the exact same filter query params as :func:`list_orphans` (the
    report is "a filtered slice, grouped by a dimension") and shares its WHERE
    building — scoping included — through :func:`_apply_orphan_filters`, so a
    caller always sees ``total`` equal to the filtered list's ``total``.

    NULL dimension values land in an explicit "unspecified" bucket, never
    dropped. For the sensitive dimensions (governorate, orphanage) buckets
    smaller than :data:`SEGMENT_MIN_BUCKET` collapse into "other" — see the
    k-anonymity note on the constant. Buckets are ordered by count descending
    with a stable tiebreak on key. Registered before ``/{orphan_id}`` so
    "segments" is never parsed as an id.
    """
    key_expr, label_expr, join = _segment_grouping(by)
    columns: list[Any] = [key_expr.label("key")]
    if label_expr is not None:
        columns.append(label_expr.label("label"))
    columns.append(func.count().label("count"))

    stmt = select(*columns).select_from(Orphan)
    if join is not None:
        target, onclause = join
        stmt = stmt.outerjoin(target, onclause)
    stmt = _apply_orphan_filters(
        stmt,
        user,
        case_status=case_status,
        channel_id=channel_id,
        assignment_status=assignment_status,
        education_stage=education_stage,
        health_status=health_status,
        is_hafiz=is_hafiz,
        min_juz=min_juz,
        tags=tags,
        tags_mode=tags_mode,
        orphan_type=orphan_type,
        priority=priority,
        min_waiting_days=min_waiting_days,
        min_completion=min_completion,
        q=q,
    )
    stmt = stmt.group_by(key_expr) if label_expr is None else stmt.group_by(key_expr, label_expr)
    rows = (await db.execute(stmt)).all()

    buckets: list[SegmentBucket] = []
    for row in rows:
        raw_key = row[0]
        label = row[1] if label_expr is not None and raw_key is not None else None
        buckets.append(
            SegmentBucket(
                key="unspecified" if raw_key is None else str(raw_key),
                label=str(label) if label is not None else None,
                count=int(row[-1]),
            )
        )

    if by in _SENSITIVE_SEGMENT_DIMENSIONS:
        buckets = _collapse_small_buckets(
            buckets,
            lambda small: SegmentBucket(key="other", label=None, count=sum(b.count for b in small)),
        )

    buckets.sort(key=lambda b: (-b.count, b.key))
    return OrphanSegments(dimension=by, total=sum(b.count for b in buckets), buckets=buckets)


# ── Community follow-up report (GET /orphans/community-report) ──────────
#
# Read-only aggregate over the OUT-OF-HOME orphans — children living with
# family (``orphanage_id IS NULL``, the exact complement of a dar's
# residents per the orphanage_self definition). Counts and averages only,
# zero PII, staff surface only. Mirrors the /orphans/segments posture:
# response models colocated here, the same filter params, the same
# k-anonymity floor on the geographic dimension. Unlike /segments the
# geographic grouping is the FAMILY governorate (via Orphan.family_id →
# Family), never the dar's — these children have no dar.


class ReportsCadence(BaseModel):
    """Top-line reporting-cadence tallies, shared verbatim by this report and
    the house report (``orphanages.py`` imports it — the same one-way
    direction as ``SegmentBucket``) so the two can never drift apart.
    Each child in the slice lands in exactly one state, classified from its
    latest non-draft ``period_end`` against :func:`due_status_cutoffs`."""

    cadence_days: int  # effective_cadence(org)
    grace_days: int  # REPORT_OVERDUE_GRACE_DAYS, exposed for honest labels
    on_track: int
    due_soon: int
    overdue: int  # includes children who never reported


class GovernorateFollowup(BaseModel):
    # The family governorate name; "unspecified" for children with no family
    # or no recorded governorate, "other" for the k-anonymity collapse of
    # sub-threshold governorates (see SEGMENT_MIN_BUCKET).
    governorate: str
    count: int
    # The cadence partition of count (same cutoffs as the top line):
    # on_track + due_soon + overdue == count, always.
    on_track: int
    due_soon: int
    overdue: int


class CommunitySponsorshipCoverage(BaseModel):
    sponsored: int
    unsponsored: int
    sponsored_pct: int | None  # None when the slice is empty


class CommunityFileCompletion(BaseModel):
    avg_completion: int | None  # None when the slice is empty
    incomplete_count: int  # children below FILE_INCOMPLETE_THRESHOLD


class CommunityFollowupReport(BaseModel):
    total: int
    governorates: list[GovernorateFollowup]
    reporting: ReportsCadence
    lives_with: list[SegmentBucket]
    health: list[SegmentBucket]
    sponsorship: CommunitySponsorshipCoverage
    files: CommunityFileCompletion


@router.get("/community-report", response_model=CommunityFollowupReport)
async def community_followup_report(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    case_status: str | None = None,
    channel_id: UUID | None = None,
    assignment_status: Literal["active", "expired", "all"] = "all",
    education_stage: EducationStage | None = None,
    health_status: HealthStatus | None = None,
    is_hafiz: bool | None = None,
    min_juz: Annotated[int | None, Query(ge=0, le=30)] = None,
    tags: Annotated[list[str] | None, Query()] = None,
    tags_mode: Literal["all", "any"] = "all",
    orphan_type: Literal["single", "double"] | None = None,
    priority: PriorityLevel | None = None,
    min_waiting_days: Annotated[int | None, Query(ge=0)] = None,
    min_completion: Annotated[int | None, Query(ge=0, le=100)] = None,
    q: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
) -> CommunityFollowupReport:
    """Aggregate "community follow-up" report over the out-of-home orphans.

    A community orphan lives with family, not in a dar: ``orphanage_id IS
    NULL`` (the ``orphanage_self`` definition of a family placement) — the
    exact complement of the house report's residents. Accepts the same
    optional filter params as :func:`list_orphans` and shares its WHERE
    building — org + جهة scoping included — through
    :func:`_apply_orphan_filters`, then restricts to the out-of-home slice.

    The geographic breakdown groups by the FAMILY governorate (outer join on
    ``family_id``, so children with no family land in "unspecified" rather
    than dropping out) and reports, per governorate, the headcount AND its
    cadence partition (the house-report definition verbatim: each child's
    latest non-draft ``period_end`` classified as on_track / due_soon /
    overdue against :func:`due_status_cutoffs` for the org's
    :func:`effective_cadence`). Governorate is a sensitive child-data
    dimension, so sub-threshold buckets collapse into "other" — every tally
    carried, never lost — while "unspecified" stays its own bucket whatever
    its size. Buckets are ordered by count descending with a stable tiebreak
    on key. Registered before ``/{orphan_id}`` so "community-report" is
    never parsed as an id.
    """

    def community_slice[SelectT: Select[Any]](stmt: SelectT) -> SelectT:
        """The report's slice: the shared scoping + list filters, restricted
        to family placements. Every aggregate below runs through this one
        builder so the figures can never drift apart."""
        return _apply_orphan_filters(
            stmt,
            user,
            case_status=case_status,
            channel_id=channel_id,
            assignment_status=assignment_status,
            education_stage=education_stage,
            health_status=health_status,
            is_hafiz=is_hafiz,
            min_juz=min_juz,
            tags=tags,
            tags_mode=tags_mode,
            orphan_type=orphan_type,
            priority=priority,
            min_waiting_days=min_waiting_days,
            min_completion=min_completion,
            q=q,
        ).where(Orphan.orphanage_id.is_(None))

    # The caller's org sets the cadence the whole report classifies against.
    # Queried explicitly (the relationship is lazy="raise") and org-scoped
    # like everything else here.
    org = await db.scalar(select(Organization).where(Organization.id == user.organization_id))
    if org is None:
        raise NotFound("Organization")
    cadence = effective_cadence(org)
    on_track_floor, due_soon_floor = due_status_cutoffs(cadence, date.today())

    # Each child's latest non-draft period_end (the house-report definition),
    # built once and LEFT-JOINed so children with no non-draft report carry
    # NULL. Server-side only — never returned per child. The three predicates
    # PARTITION the slice exactly: NULL never matches the first two and
    # overdue catches it explicitly, so the tallies always sum to total.
    latest_report = (
        select(
            OrphanReport.orphan_id.label("orphan_id"),
            func.max(OrphanReport.period_end).label("last_period_end"),
        )
        .where(
            OrphanReport.organization_id == user.organization_id,
            OrphanReport.status != "draft",
        )
        .group_by(OrphanReport.orphan_id)
        .subquery()
    )
    last_period_end = latest_report.c.last_period_end
    is_on_track = last_period_end >= on_track_floor
    is_due_soon = and_(last_period_end < on_track_floor, last_period_end >= due_soon_floor)
    is_overdue = or_(last_period_end.is_(None), last_period_end < due_soon_floor)

    # One pass over the slice for every scalar aggregate: headcount,
    # sponsorship coverage, the two file-completion figures and the
    # three cadence tallies.
    totals = (
        await db.execute(
            community_slice(
                select(
                    func.count(),
                    func.count().filter(Orphan.case_status == "sponsored"),
                    func.avg(Orphan.profile_completion_percentage),
                    func.count().filter(
                        Orphan.profile_completion_percentage < FILE_INCOMPLETE_THRESHOLD
                    ),
                    func.count().filter(is_on_track),
                    func.count().filter(is_due_soon),
                    func.count().filter(is_overdue),
                )
                .select_from(Orphan)
                .outerjoin(latest_report, latest_report.c.orphan_id == Orphan.id)
            )
        )
    ).one()
    total = int(totals[0])
    sponsored = int(totals[1])
    avg_completion = int(round(totals[2])) if totals[2] is not None else None
    incomplete_count = int(totals[3])
    on_track, due_soon, overdue = int(totals[4]), int(totals[5]), int(totals[6])

    gov_rows = (
        await db.execute(
            community_slice(
                select(
                    Family.governorate,
                    func.count(),
                    func.count().filter(is_on_track),
                    func.count().filter(is_due_soon),
                    func.count().filter(is_overdue),
                )
                .select_from(Orphan)
                .outerjoin(Family, Orphan.family_id == Family.id)
                .outerjoin(latest_report, latest_report.c.orphan_id == Orphan.id)
                .group_by(Family.governorate)
            )
        )
    ).all()
    governorates = [
        GovernorateFollowup(
            governorate="unspecified" if row[0] is None else str(row[0]),
            count=int(row[1]),
            on_track=int(row[2]),
            due_soon=int(row[3]),
            overdue=int(row[4]),
        )
        for row in gov_rows
    ]
    governorates = _collapse_small_buckets(
        governorates,
        lambda small: GovernorateFollowup(
            governorate="other",
            count=sum(b.count for b in small),
            on_track=sum(b.on_track for b in small),
            due_soon=sum(b.due_soon for b in small),
            overdue=sum(b.overdue for b in small),
        ),
        exempt=lambda b: b.governorate == "unspecified",
    )
    governorates.sort(key=lambda b: (-b.count, b.governorate))

    lives_with_rows = (
        await db.execute(
            community_slice(
                select(Orphan.lives_with, func.count())
                .select_from(Orphan)
                .group_by(Orphan.lives_with)
            )
        )
    ).all()
    health_rows = (
        await db.execute(
            community_slice(
                select(Orphan.health_status, func.count())
                .select_from(Orphan)
                .group_by(Orphan.health_status)
            )
        )
    ).all()

    return CommunityFollowupReport(
        total=total,
        governorates=governorates,
        reporting=ReportsCadence(
            cadence_days=cadence,
            grace_days=REPORT_OVERDUE_GRACE_DAYS,
            on_track=on_track,
            due_soon=due_soon,
            overdue=overdue,
        ),
        lives_with=_breakdown_buckets(list(lives_with_rows)),
        health=_breakdown_buckets(list(health_rows)),
        sponsorship=CommunitySponsorshipCoverage(
            sponsored=sponsored,
            unsponsored=total - sponsored,
            sponsored_pct=round(sponsored * 100 / total) if total else None,
        ),
        files=CommunityFileCompletion(
            avg_completion=avg_completion,
            incomplete_count=incomplete_count,
        ),
    )


# Roles that may register an orphan via this staff endpoint: the partner-scoped
# submitters plus org admins. Guardians use the separate, resource-gated
# POST /guardian/me/orphans route, so they never pass through this gate; pure
# consumers (donor / orphan / viewer) and the marketing/finance roles are 403'd.
ORPHAN_CREATOR_ROLES: tuple[str, ...] = (*PARTNER_SCOPED_ROLES, *ADMIN_ROLES)


@router.post("", response_model=OrphanRead, status_code=status.HTTP_201_CREATED)
async def create_orphan(
    payload: OrphanCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ORPHAN_CREATOR_ROLES))],
) -> OrphanRead:
    """Register an orphan (lands ``pending_review``).

    Delegates to the shared :func:`create_orphan_record`, which is also used by
    the guardian self-service endpoint — so both obey the same no-duplicate
    rule (a violation of ``idx_orphans_no_duplicate`` comes back as a 409).
    """
    # The orphan's جهة is resolved server-side — mirroring the partner scoping
    # the read/update surfaces already enforce — never trusted from the client.
    if user.role in PARTNER_SCOPED_ROLES:
        # A partner-scoped caller creates inside their own جهة or not at all;
        # whatever جهة the payload carries is ignored.
        if user.partner_organization_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account has no partner organization assigned",
            )
        partner_organization_id = user.partner_organization_id
        # Same جهة fence as PATCH /orphans/{id}: the child may only be pinned
        # to a dar inside the caller's own جهة, not merely anywhere in the org.
        if payload.orphanage_id is not None:
            await _assert_orphanage_in_partner_org(
                db, payload.orphanage_id, partner_organization_id
            )
    else:
        # Admins pick the جهة from the payload, but only inside their own
        # organization (same ownership posture as users.py). Their dar keeps
        # the org-level check, applied inside create_orphan_record — an admin
        # may attach a dar from any جهة in the org, exactly as on PATCH.
        partner_organization_id = payload.partner_organization_id
        await _assert_partner_org_in_org(db, partner_organization_id, user.organization_id)

    orphan = await create_orphan_record(
        db,
        user=user,
        data=payload,
        partner_organization_id=partner_organization_id,
        family_id=payload.family_id,
        via="staff",
        orphanage_id=payload.orphanage_id,
    )
    return OrphanRead.model_validate(orphan)


@router.get("/name-matches", response_model=list[OrphanNameMatch])
async def list_orphan_name_matches(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ORPHAN_CREATOR_ROLES))],
    first_name: Annotated[str, Query(min_length=1, max_length=100)],
    family_name: Annotated[str, Query(min_length=1, max_length=100)],
) -> list[OrphanNameMatch]:
    """Advisory soft-duplicate lookup behind the staff registration form.

    Returns the non-deleted orphans in the caller's organization whose
    ``first_name`` + ``family_name`` match (case-insensitive). The form calls
    this BEFORE submitting an orphan that carries no ``national_id``: when it
    returns any rows, the form warns that a child with this name already exists
    and lets the user confirm it is not a duplicate before proceeding. It is
    purely advisory and read-only — it never blocks a create, and the hard
    guards (the name/DOB/father composite index and the national_id blind index)
    still return 409 on the create itself.

    Gated to the orphan-creator roles (same as ``POST /orphans``) and org-scoped,
    mirroring the duplicate pre-check in
    :func:`~app.services.orphans._find_duplicate`. Registered before the
    ``/{orphan_id}`` route so ``name-matches`` is never parsed as an id. Only the
    non-sensitive identity fields are returned — never ``national_id``.
    """
    matches = await find_name_matches(db, user.organization_id, first_name, family_name)
    return [OrphanNameMatch.model_validate(m) for m in matches]


_CSV_COLUMNS = (
    "code",
    "first_name",
    "family_name",
    "date_of_birth",
    "gender",
    "nationality",
    "case_status",
    "is_sponsored",
    "current_balance",
    "created_at",
)


@router.get("/export.csv")
async def export_orphans_csv(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    case_status: str | None = None,
) -> StreamingResponse:
    """Stream non-deleted orphans (optionally filtered by case_status)
    as CSV. Capped at 10 000 rows. Registered before /{orphan_id} so
    FastAPI doesn't try to parse 'export.csv' as a UUID."""
    # Mirror list_orphans' scoping exactly: explicit org filter (defense-in-depth
    # alongside RLS) plus the partner-scope block for partner_manager/partner_staff.
    stmt = select(Orphan).where(
        Orphan.deleted_at.is_(None),
        Orphan.organization_id == user.organization_id,
    )
    if user.role in PARTNER_SCOPED_ROLES:
        if user.partner_organization_id is None:
            stmt = stmt.where(false())
        else:
            stmt = stmt.where(Orphan.partner_organization_id == user.partner_organization_id)
    if case_status:
        stmt = stmt.where(Orphan.case_status == case_status)
    stmt = stmt.order_by(Orphan.created_at.desc()).limit(10_000)
    rows = (await db.scalars(stmt)).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_CSV_COLUMNS)
    for o in rows:
        writer.writerow(
            [
                o.code,
                o.first_name,
                o.family_name,
                o.date_of_birth.isoformat() if o.date_of_birth else "",
                o.gender,
                o.nationality or "",
                o.case_status,
                "true" if o.is_sponsored else "false",
                str(o.current_balance or 0),
                o.created_at.isoformat(),
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="rufaqaa-orphans.csv"'},
    )


@router.get("/{orphan_id}", response_model=OrphanRead)
async def get_orphan(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> OrphanRead:
    # Org filter is the outer gate for every role (a cross-org id 404s here);
    # partner_scope_hides() then narrows within the org for partner-scoped roles.
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    # Partner-scoped callers must not learn that an orphan outside their جهة
    # exists — 404 rather than 403 so existence stays hidden.
    if partner_scope_hides(user, orphan.partner_organization_id):
        raise NotFound("Orphan")
    return OrphanRead.model_validate(orphan)


@router.patch("/{orphan_id}", response_model=OrphanRead)
async def update_orphan(
    orphan_id: UUID,
    payload: OrphanUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> OrphanRead:
    # Org filter is the outer gate for every role (a cross-org id 404s here);
    # partner_scope_hides() then narrows within the org for partner-scoped roles.
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    # Mirror get_orphan: a partner-scoped caller cannot modify (or even confirm
    # the existence of) an orphan outside their جهة — 404, not 403.
    if partner_scope_hides(user, orphan.partner_organization_id):
        raise NotFound("Orphan")

    data = payload.model_dump(exclude_unset=True)
    # orphanage_id is the one editable field that can point across tenants;
    # validate ownership explicitly before applying (a superuser connection
    # bypasses RLS). An explicit null clears the assignment (always allowed).
    # Partner-scoped callers (with a جهة set) must keep the child inside THEIR
    # جهة, so they validate against the partner org rather than the whole org;
    # everyone else keeps the org-level check.
    if data.get("orphanage_id") is not None:
        if user.role in PARTNER_SCOPED_ROLES and user.partner_organization_id is not None:
            await _assert_orphanage_in_partner_org(
                db, data["orphanage_id"], user.partner_organization_id
            )
        else:
            await _assert_orphanage_in_org(db, data["orphanage_id"], user.organization_id)

    changes: dict[str, dict[str, str | None]] = {}
    for field, value in data.items():
        old = getattr(orphan, field)
        if old != value:
            changes[field] = {"old": _stringify(old), "new": _stringify(value)}
            setattr(orphan, field, value)

    # Recompute the derived completion% from the freshly-updated fields. Done
    # after `changes` is built so it never leaks into the audit old/new values.
    recompute_profile_completion(orphan)

    if changes:
        record_audit(
            db,
            organization_id=user.organization_id,
            user_id=user.id,
            action="orphan.updated",
            entity_type="orphan",
            entity_id=orphan.id,
            old_values={k: v["old"] for k, v in changes.items()},
            new_values={k: v["new"] for k, v in changes.items()},
        )
    await db.commit()
    await db.refresh(orphan)
    return OrphanRead.model_validate(orphan)


def _stringify(v: Any) -> Any:
    """JSON-safe representation for audit values (dates → ISO, UUIDs → str)."""
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


@router.delete("/{orphan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_orphan(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> None:
    """Soft-delete an orphan record. Restricted to org admins."""
    # Org-scoped fetch — a cross-org id 404s, never deleting another org's row.
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    orphan.deleted_at = datetime.now(UTC)
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.deleted",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"code": orphan.code},
        is_sensitive=True,
    )
    await db.commit()


class AssignChannelPayload(BaseModel):
    """Pass channel_id=null to unassign."""

    channel_id: UUID | None


@router.post("/{orphan_id}/assign-channel", response_model=OrphanRead)
async def assign_orphan_channel(
    orphan_id: UUID,
    payload: AssignChannelPayload,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> OrphanRead:
    """Attach (or detach) an orphan to a marketing channel. Validates
    that the channel belongs to the same organization and is active;
    null clears the assignment."""
    # Org-scoped fetch — a cross-org id 404s. The channel below is then required
    # to share this (in-org) orphan's organization_id, so it cannot cross tenants.
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))

    if payload.channel_id is not None:
        channel = await db.scalar(
            select(MarketingChannel).where(MarketingChannel.id == payload.channel_id)
        )
        if channel is None:
            raise NotFound("Marketing channel")
        if channel.organization_id != orphan.organization_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Channel belongs to a different organization",
            )
        if channel.status != "active":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot assign to a non-active channel",
            )

    old = orphan.assigned_to_channel_id
    orphan.assigned_to_channel_id = payload.channel_id
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.channel_assigned",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"assigned_to_channel_id": str(old) if old else None},
        new_values={
            "assigned_to_channel_id": (str(payload.channel_id) if payload.channel_id else None)
        },
    )
    await db.commit()
    await db.refresh(orphan)
    return OrphanRead.model_validate(orphan)


# ── Case-status workflow ───────────────────────────────────────────────
#
# Schema's CaseStatus enum: pending_review → approved → available →
# reserved → sponsored → graduated/deceased/archived (or → rejected).
# OrphanUpdate intentionally excludes case_status — every status change
# flows through one of the endpoints below. partner_staff submits an
# orphan record (which lands as pending_review); partner_manager or an
# org admin reviews it.

# Approvers can decide on a pending case. partner_staff cannot — they
# submit, they don't approve. Mirrors the report-workflow split.
PARTNER_APPROVER_ROLES: tuple[str, ...] = ("partner_manager", *ADMIN_ROLES)


class OrphanRejectPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


async def _load_orphan_or_404(db: AsyncSession, orphan_id: UUID, user: User) -> Orphan:
    # Explicit org scope, never RLS — the app's superuser connection bypasses
    # RLS. A cross-org id 404s here (existence never leaks), the outer gate for
    # all roles; the partner_scope_hides() check layers on top, within the org.
    return await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))


def _check_case_transition(orphan: Orphan, expected_from: tuple[str, ...]) -> None:
    if orphan.case_status not in expected_from:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Orphan is in case_status '{orphan.case_status}', "
                f"expected one of {sorted(expected_from)}"
            ),
        )


@router.post("/{orphan_id}/approve", response_model=OrphanRead)
async def approve_orphan(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*PARTNER_APPROVER_ROLES))],
) -> OrphanRead:
    """Mark a pending_review orphan as approved.

    Only partner_manager + org admins may approve — partner_staff submits
    but cannot self-approve, same separation the report workflow uses.

    Segregation of duties: a non-admin approver may not approve a record they
    created themselves (``created_by == user.id``) — that's a 403. This closes
    the partner_manager dual-role of registering an orphan and then approving
    their own submission. :data:`ADMIN_ROLES` (super_admin / org_admin) are
    exempt — they are the escalation path, and exempting them keeps a
    single-admin org from deadlocking. Only approval is fenced this way; reject
    and release are not.
    """
    orphan = await _load_orphan_or_404(db, orphan_id, user)
    # Mirror update_orphan: a partner_manager may only decide on cases inside
    # their own جهة — 404 (never 403, and before the state check so a 409
    # can't leak case_status) keeps an out-of-جهة orphan's existence hidden.
    if partner_scope_hides(user, orphan.partner_organization_id):
        raise NotFound("Orphan")
    # Segregation of duties: the creator of a record may not also approve it.
    # created_by is stamped at creation (services/orphans.py), so the data is
    # always present; a NULL created_by never equals a real user id, so an
    # orphan with no recorded creator is never blocked. Admins are exempt — the
    # escalation path that prevents a one-admin org from deadlocking.
    if user.role not in ADMIN_ROLES and orphan.created_by == user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot approve an orphan record you created",
        )
    _check_case_transition(orphan, ("pending_review",))

    old_status = orphan.case_status
    orphan.case_status = "approved"
    orphan.approved_by_partner_at = datetime.now(UTC)
    orphan.approved_by_partner_user_id = user.id
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.approved",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"case_status": old_status},
        new_values={"case_status": orphan.case_status},
    )
    await db.commit()
    await db.refresh(orphan)
    return OrphanRead.model_validate(orphan)


@router.post("/{orphan_id}/reject", response_model=OrphanRead)
async def reject_orphan(
    orphan_id: UUID,
    payload: OrphanRejectPayload,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*PARTNER_APPROVER_ROLES))],
) -> OrphanRead:
    """Reject a pending_review orphan. Reason is required and stored on
    the row so reviewers can see why this case didn't move forward."""
    orphan = await _load_orphan_or_404(db, orphan_id, user)
    # Same جهة fence as approve_orphan: out-of-جهة cases 404 before the state check.
    if partner_scope_hides(user, orphan.partner_organization_id):
        raise NotFound("Orphan")
    _check_case_transition(orphan, ("pending_review",))

    old_status = orphan.case_status
    orphan.case_status = "rejected"
    orphan.rejection_reason = payload.reason
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.rejected",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"case_status": old_status},
        new_values={"case_status": orphan.case_status, "rejection_reason": payload.reason},
    )
    await db.commit()
    await db.refresh(orphan)
    return OrphanRead.model_validate(orphan)


@router.post("/{orphan_id}/release", response_model=OrphanRead)
async def release_orphan(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*PARTNER_APPROVER_ROLES))],
) -> OrphanRead:
    """Move an approved or reserved orphan back to the available pool —
    clearing any marketing-channel assignment. Used when a reservation
    lapses or a channel is reshuffled."""
    orphan = await _load_orphan_or_404(db, orphan_id, user)
    # Same جهة fence as approve_orphan: out-of-جهة cases 404 before the state check.
    if partner_scope_hides(user, orphan.partner_organization_id):
        raise NotFound("Orphan")
    _check_case_transition(orphan, ("approved", "reserved"))

    old_status = orphan.case_status
    old_channel = orphan.assigned_to_channel_id
    orphan.case_status = "available"
    stamp_available_since(orphan)
    orphan.assigned_to_channel_id = None
    orphan.assignment_deadline = None
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.released",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={
            "case_status": old_status,
            "assigned_to_channel_id": str(old_channel) if old_channel else None,
        },
        new_values={"case_status": orphan.case_status, "assigned_to_channel_id": None},
    )
    await db.commit()
    await db.refresh(orphan)
    return OrphanRead.model_validate(orphan)


# ── Donor-profile element visibility (staff/manager control) ───────────────
#
# A supervisor/manager shows or hides ANY element of the donor-facing child
# profile; the hidden element is enforced in the BACKEND (the donor composition
# omits it server-side). Restricted to the partner-scoped submitters/managers
# plus org admins — pure consumers (donor) and the marketing/finance roles are
# 403'd. Org scope is ALWAYS explicit (a superuser connection bypasses RLS),
# with the same جهة fence the other orphan detail endpoints use.
PROFILE_VISIBILITY_ROLES: tuple[str, ...] = ("partner_staff", "partner_manager", *ADMIN_ROLES)


def _visibility_registry(orphan: Orphan) -> ProfileVisibilityRegistry:
    """Full registry: every element with its current effective state (visible
    unless explicitly false) plus the raw stored map."""
    stored = orphan.profile_visibility or {}
    return ProfileVisibilityRegistry(
        elements=[
            ProfileElementState(key=element, visible=is_visible(stored, element))
            for element in ProfileElement
        ],
        stored=stored,
    )


@router.get("/{orphan_id}/profile-visibility", response_model=ProfileVisibilityRegistry)
async def get_orphan_profile_visibility(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*PROFILE_VISIBILITY_ROLES))],
) -> ProfileVisibilityRegistry:
    """The donor-profile visibility registry for one child: every
    :class:`ProfileElement` with its current effective state, plus the raw
    stored map. Org-scoped (explicit, never RLS) with the same جهة fence as
    :func:`get_orphan` — an out-of-org/جهة id 404s."""
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    if partner_scope_hides(user, orphan.partner_organization_id):
        raise NotFound("Orphan")
    return _visibility_registry(orphan)


@router.put("/{orphan_id}/profile-visibility", response_model=ProfileVisibilityRegistry)
async def set_orphan_profile_visibility(
    orphan_id: UUID,
    payload: ProfileVisibilityUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*PROFILE_VISIBILITY_ROLES))],
) -> ProfileVisibilityRegistry:
    """Replace a child's donor-profile visibility map. The body's keys are
    validated against :class:`ProfileElement` and values against ``bool`` at the
    Pydantic boundary (unknown key / non-bool ⇒ 422). Same org + جهة scoping as
    the GET twin."""
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    if partner_scope_hides(user, orphan.partner_organization_id):
        raise NotFound("Orphan")

    old = orphan.profile_visibility or {}
    stored = {element.value: value for element, value in payload.visibility.items()}
    orphan.profile_visibility = stored
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.profile_visibility_updated",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"profile_visibility": old},
        new_values={"profile_visibility": stored},
    )
    await db.commit()
    await db.refresh(orphan)
    return _visibility_registry(orphan)


# ── Father's memory (ذكرى الأب) — guardian-consent gate ────────────────────
#
# The donor-facing "father's memory" block (the father's name + the YEAR of
# death) is DOUBLE-GATED: it reaches the donor ONLY when BOTH guardian consent
# is on record (this endpoint) AND the supervisor left the ``father_memory``
# element visible (the existing profile-visibility PUT). Default is hidden until
# explicitly consented. This sets only the consent gate — the visibility toggle
# reuses PUT /orphans/{id}/profile-visibility. Org scope is ALWAYS explicit (a
# superuser connection bypasses RLS), with the same جهة fence the other orphan
# detail endpoints use.


@router.get("/{orphan_id}/father-memory-consent", response_model=FatherMemoryConsent)
async def get_orphan_father_memory_consent(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> FatherMemoryConsent:
    """The current guardian-consent state for disclosing the child's father's
    memory. Org-scoped (explicit, never RLS) with the same جهة fence as
    :func:`get_orphan` — an out-of-org/جهة id 404s."""
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    if partner_scope_hides(user, orphan.partner_organization_id):
        raise NotFound("Orphan")
    return FatherMemoryConsent(consent=orphan.father_memory_consent)


@router.patch("/{orphan_id}/father-memory-consent", response_model=FatherMemoryConsent)
async def set_orphan_father_memory_consent(
    orphan_id: UUID,
    payload: FatherMemoryConsent,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> FatherMemoryConsent:
    """Record (or revoke) the guardian's consent to disclose the child's
    father's memory on the donor profile. This is the FIRST of the two gates;
    the supervisor visibility toggle (PUT /profile-visibility) is the second —
    the block reaches the donor only when both are on. Same org + جهة scoping as
    the GET twin."""
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    if partner_scope_hides(user, orphan.partner_organization_id):
        raise NotFound("Orphan")

    old = orphan.father_memory_consent
    orphan.father_memory_consent = payload.consent
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.father_memory_consent_updated",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"father_memory_consent": old},
        new_values={"father_memory_consent": payload.consent},
    )
    await db.commit()
    await db.refresh(orphan)
    return FatherMemoryConsent(consent=orphan.father_memory_consent)


# ── "In Her Words" (بكلماتها) — curated child phrases ──────────────────────
#
# A supervisor-authored, ordered list of short child phrases shown on the donor
# profile, governed by the same per-element visibility map as every other block
# (ProfileElement.in_her_words). The management contract carries the stable id
# of each phrase; the donor projection (donor_portal) strips it to text+said_on.
# Org scope is ALWAYS explicit (a superuser connection bypasses RLS), with the
# same جهة fence the other orphan detail endpoints use.


def _in_her_words_list(orphan: Orphan) -> InHerWordsList:
    """Project the stored JSONB array into the staff contract, preserving order
    (the array order IS the display order)."""
    return InHerWordsList(
        items=[InHerWordsStaffItem.model_validate(item) for item in (orphan.in_her_words or [])]
    )


@router.get("/{orphan_id}/in-her-words", response_model=InHerWordsList)
async def get_orphan_in_her_words(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> InHerWordsList:
    """The full ordered list of curated phrases for one child (including the
    stable ids the management UI needs). Org-scoped (explicit, never RLS) with
    the same جهة fence as :func:`get_orphan` — an out-of-org/جهة id 404s."""
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    if partner_scope_hides(user, orphan.partner_organization_id):
        raise NotFound("Orphan")
    return _in_her_words_list(orphan)


@router.put("/{orphan_id}/in-her-words", response_model=InHerWordsList)
async def set_orphan_in_her_words(
    orphan_id: UUID,
    payload: list[InHerWordsItemUpdate],
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> InHerWordsList:
    """Replace the whole curated-phrases array (the array order becomes the donor
    display order). Per-item rules — trimmed non-empty text capped at 280 chars,
    ``said_on`` never in the future — are enforced at the Pydantic boundary; the
    list is capped at :data:`IN_HER_WORDS_MAX_ITEMS` here. Each item re-uses its
    supplied ``id`` (edit/reorder) or is assigned a fresh ``uuid4`` (new phrase).
    Same org + جهة scoping as the GET twin."""
    if len(payload) > IN_HER_WORDS_MAX_ITEMS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"At most {IN_HER_WORDS_MAX_ITEMS} phrases are allowed",
        )
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    if partner_scope_hides(user, orphan.partner_organization_id):
        raise NotFound("Orphan")

    old = orphan.in_her_words or []
    stored: list[dict[str, Any]] = [
        {
            "id": str(item.id or uuid4()),
            "text": item.text,
            "said_on": item.said_on.isoformat() if item.said_on else None,
        }
        for item in payload
    ]
    orphan.in_her_words = stored
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.in_her_words_updated",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"in_her_words": old},
        new_values={"in_her_words": stored},
    )
    await db.commit()
    await db.refresh(orphan)
    return _in_her_words_list(orphan)


@router.get("/{orphan_id}/timeline", response_model=Timeline)
async def orphan_timeline(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> Timeline:
    """Chronological feed of everything that has happened around an orphan:
    sponsorships, payments, and reports. Newest first, capped at 200
    events."""
    # Org filter is the outer gate for every role (a cross-org id 404s here);
    # partner_scope_hides() then narrows within the org for partner-scoped roles.
    orphan = await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    # Mirror get_orphan: partner-scoped callers must not read (or even confirm
    # the existence of) the timeline of an orphan outside their جهة — 404, not 403.
    if partner_scope_hides(user, orphan.partner_organization_id):
        raise NotFound("Orphan")

    sponsorships = (
        await db.scalars(select(Sponsorship).where(Sponsorship.orphan_id == orphan_id))
    ).all()
    payments = (await db.scalars(select(Payment).where(Payment.orphan_id == orphan_id))).all()
    reports = (
        await db.scalars(select(OrphanReport).where(OrphanReport.orphan_id == orphan_id))
    ).all()

    events: list[TimelineEvent] = []
    for sp in sponsorships:
        events.append(
            TimelineEvent(
                when=sp.created_at,
                kind="sponsorship",
                entity_id=sp.id,
                summary=f"{sp.code} · {sp.monthly_amount} {sp.currency}/{sp.payment_frequency}",
                amount=sp.monthly_amount,
                currency=sp.currency,
                status=sp.status,
            )
        )
    for p in payments:
        events.append(
            TimelineEvent(
                when=p.completed_at or p.initiated_at,
                kind="payment",
                entity_id=p.id,
                summary=f"{p.code} · {p.payment_method}",
                amount=p.amount,
                currency=p.currency,
                status=p.status,
            )
        )
    for r in reports:
        events.append(
            TimelineEvent(
                when=r.created_at,
                kind="report",
                entity_id=r.id,
                summary=f"{r.report_type} ({r.period_start}–{r.period_end})",
                status=r.status,
            )
        )

    events.sort(key=lambda e: e.when, reverse=True)
    return Timeline(items=events[:200])
