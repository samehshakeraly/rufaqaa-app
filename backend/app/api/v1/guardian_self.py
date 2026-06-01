"""Guardian self-service endpoints under `/guardian/me`.

Mirrors the donor self-portal pattern (`donor_self.py`): no `require_roles`
on the dependency, because the resource itself is the gate — only users
that actually have a `guardians.user_id` row pointing to them will resolve.
Anyone else gets a 404.

Privacy posture, hard-baked:
  - Orphans are projected through `GuardianOrphanRead` which **never**
    serialises `current_balance`, `is_sponsored`, `balance_currency`, or
    partner identity. The financial fields can be opted in per org via
    `business_rules.show_financial_to_guardian = TRUE` (default FALSE).
  - Cross-family access raises 403, not 404, so we don't leak that other
    families exist in the same org.

Writes are deliberately limited. A guardian may **submit a monthly report**
(`POST /me/reports`) and **upload documents** for their own orphans
(`POST /me/orphans/{id}/documents`); both land in a pending state
(`pending_partner_approval` / `verification_status='pending'`) and surface in
the existing staff review workflows — nothing is auto-published, and no donor
identity is ever exposed. The guardian *profile* itself stays read-only here
(literacy_level, banking, etc. are edited only via the staff/admin endpoints).
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.core.exceptions import NotFound
from app.models.document import Document
from app.models.family import Guardian
from app.models.orphan import Orphan
from app.models.report import OrphanReport
from app.models.user import User
from app.schemas.document import DocumentRead, DocumentType
from app.schemas.report import ReportRead, ReportType
from app.services.audit import record_audit
from app.services.storage import ensure_bucket, put_object

router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────────


class GuardianFamilyMini(BaseModel):
    """Just enough to anchor the UI — no street address, no income."""

    id: UUID
    code: str
    family_name: str | None
    country_code: str | None
    governorate: str | None


class GuardianMeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID | None
    full_name: str
    relation: str
    literacy_level: str
    preferred_communication: str
    phone: str | None
    whatsapp: str | None
    email: str | None
    status: str
    family: GuardianFamilyMini | None


class GuardianOrphanFinancials(BaseModel):
    """Only attached when `business_rules.show_financial_to_guardian` is
    TRUE for the guardian's org."""

    current_balance: str | None
    balance_currency: str | None
    is_sponsored: bool


class GuardianOrphanRead(BaseModel):
    """Guardian-safe projection of an orphan.

    Notice the omitted fields: no `current_balance`, no `balance_currency`,
    no `is_sponsored`, no partner_organization_id. Those are unlocked
    explicitly via `business_rules.show_financial_to_guardian = TRUE` and
    re-attached as `financials` (see below).
    """

    id: UUID
    code: str
    first_name: str
    family_name: str
    date_of_birth: date
    gender: str
    case_status: str
    profile_completion_percentage: int
    # Optional financial payload — only set when the org has opted in.
    financials: GuardianOrphanFinancials | None = None


class GuardianReportCreate(BaseModel):
    """Body for a guardian-submitted monthly report (G-04).

    Lands directly in ``pending_partner_approval`` — the guardian's act of
    sending IS the submission, so there's no draft round-trip. Text-only for
    this cut; photo/voice attachments are deferred (they need the media-upload
    + MediaReview path, which is still a stub).
    """

    orphan_id: UUID
    report_type: ReportType = "monthly"
    period_start: date
    period_end: date
    summary: str | None = None
    educational_progress: dict[str, Any] | None = None
    quran_progress: dict[str, Any] | None = None
    activities: dict[str, Any] | None = None
    health_status: dict[str, Any] | None = None
    psychological_status: dict[str, Any] | None = None


# Guardian-uploadable document MIME allow-list. Kept narrow (mirrors
# media.ALLOWED_DOCUMENT_TYPES) so the bucket can't become a dumping ground.
_GUARDIAN_DOC_MIME: frozenset[str] = frozenset(
    {"application/pdf", "image/jpeg", "image/png", "image/webp"}
)


# ── Helpers ────────────────────────────────────────────────────────────


async def _load_guardian_or_404(db: AsyncSession, user: User) -> Guardian:
    """Resolve the calling user to their Guardian row.

    Returns 404 (not 403) for non-guardian users — we don't want to
    confirm that /guardian/me is reachable when you aren't one.
    """
    guardian = await db.scalar(select(Guardian).where(Guardian.user_id == user.id))
    if guardian is None:
        raise NotFound("Guardian")
    return guardian


async def _show_financial_to_guardian(db: AsyncSession, organization_id: UUID) -> bool:
    """Read the per-org guardian-visibility flag from `business_rules`.

    No ORM model exists for business_rules yet (mirrors `media`); we hit
    it with raw SQL. Default FALSE matches the schema CHECK and the
    `show_financial_to_guardian` column default.
    """
    row = (
        await db.execute(
            text(
                "SELECT show_financial_to_guardian FROM business_rules "
                "WHERE organization_id = :org_id LIMIT 1"
            ),
            {"org_id": str(organization_id)},
        )
    ).first()
    if row is None:
        return False
    return bool(row[0])


async def _orphan_in_family_or_error(
    db: AsyncSession, guardian: Guardian, orphan_id: UUID
) -> Orphan:
    """Resolve an orphan and assert it belongs to the guardian's family.

    Unknown id → 404; a real orphan in *another* family → 403 (matching the
    read endpoints — we signal "you can't touch this" loudly rather than 404,
    which is the module-wide cross-family posture). This is the only ownership
    gate the write endpoints need: RLS already scopes everything to the org.
    """
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    if guardian.family_id is None or orphan.family_id != guardian.family_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This orphan does not belong to your family",
        )
    return orphan


# ── Endpoints ──────────────────────────────────────────────────────────


@router.get("/me", response_model=GuardianMeRead)
async def get_guardian_me(db: DbSession, user: CurrentUser) -> GuardianMeRead:
    """Return the guardian profile for the calling user.

    Joins on `families` to attach a thin family preview so the SPA can
    show "you belong to family <code>" without a second round-trip.
    """
    guardian = await _load_guardian_or_404(db, user)

    family_payload: GuardianFamilyMini | None = None
    if guardian.family_id is not None:
        family_row = (
            await db.execute(
                text(
                    "SELECT id, code, family_name, country_code, governorate "
                    "FROM families WHERE id = :id LIMIT 1"
                ),
                {"id": str(guardian.family_id)},
            )
        ).first()
        if family_row is not None:
            family_payload = GuardianFamilyMini(
                id=family_row[0],
                code=family_row[1],
                family_name=family_row[2],
                country_code=family_row[3],
                governorate=family_row[4],
            )

    return GuardianMeRead(
        id=guardian.id,
        user_id=guardian.user_id,
        full_name=guardian.full_name,
        relation=guardian.relation,
        literacy_level=guardian.literacy_level,
        preferred_communication=guardian.preferred_communication,
        phone=guardian.phone,
        whatsapp=guardian.whatsapp,
        email=guardian.email,
        status=guardian.status,
        family=family_payload,
    )


@router.get("/me/orphans", response_model=list[GuardianOrphanRead])
async def list_my_orphans(db: DbSession, user: CurrentUser) -> list[GuardianOrphanRead]:
    """List orphans belonging to the guardian's family.

    Financial fields are stripped by default. The org can opt in via
    `business_rules.show_financial_to_guardian = TRUE` — when so, the
    `financials` sub-object is attached per orphan.
    """
    guardian = await _load_guardian_or_404(db, user)

    if guardian.family_id is None:
        return []

    show_financials = await _show_financial_to_guardian(db, guardian.organization_id)

    rows = (
        await db.scalars(
            select(Orphan)
            .where(
                Orphan.family_id == guardian.family_id,
                Orphan.deleted_at.is_(None),
            )
            .order_by(Orphan.created_at.desc())
        )
    ).all()

    out: list[GuardianOrphanRead] = []
    for o in rows:
        financials = None
        if show_financials:
            financials = GuardianOrphanFinancials(
                current_balance=str(o.current_balance) if o.current_balance is not None else None,
                balance_currency=o.balance_currency,
                is_sponsored=bool(o.is_sponsored),
            )
        out.append(
            GuardianOrphanRead(
                id=o.id,
                code=o.code,
                first_name=o.first_name,
                family_name=o.family_name,
                date_of_birth=o.date_of_birth,
                gender=o.gender,
                case_status=o.case_status,
                profile_completion_percentage=o.profile_completion_percentage,
                financials=financials,
            )
        )
    return out


@router.get("/me/reports", response_model=list[ReportRead])
async def list_my_reports(
    db: DbSession,
    user: CurrentUser,
    orphan_id: Annotated[
        UUID, Query(description="Orphan UUID; must belong to the guardian's family")
    ],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[ReportRead]:
    """List reports for one of the guardian's orphans.

    403 if the orphan isn't in the guardian's family — we'd rather signal
    "you can't touch this" loudly than 404 (which would leak orphan
    existence to non-owners).
    """
    guardian = await _load_guardian_or_404(db, user)

    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    if orphan.family_id != guardian.family_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This orphan does not belong to your family",
        )

    # Re-affirm the timestamp module is in scope for ReportRead validation
    # (datetime is already imported at top).
    _ = datetime

    rows = (
        await db.scalars(
            select(OrphanReport)
            .where(OrphanReport.orphan_id == orphan_id)
            .order_by(OrphanReport.period_start.desc())
            .limit(limit)
        )
    ).all()
    return [ReportRead.model_validate(r) for r in rows]


@router.post("/me/reports", response_model=ReportRead, status_code=status.HTTP_201_CREATED)
async def create_my_report(
    payload: GuardianReportCreate,
    db: DbSession,
    user: CurrentUser,
) -> ReportRead:
    """Guardian submits a monthly report for one of their orphans (G-04).

    The report is created **directly in ``pending_partner_approval``** (not
    draft) with ``submitted_by``/``submitted_at`` set, so it appears at once
    in the staff ``PartnerReportsReview`` queue and rides the existing
    approve/reject workflow — no fork. Cross-family orphan → 403; a caller
    with no Guardian row → 404. The response is the standard ``ReportRead``,
    which carries no donor identity or financial fields.
    """
    guardian = await _load_guardian_or_404(db, user)
    if payload.period_end < payload.period_start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="period_end must be on or after period_start",
        )
    orphan = await _orphan_in_family_or_error(db, guardian, payload.orphan_id)

    report = OrphanReport(
        organization_id=user.organization_id,
        orphan_id=orphan.id,
        report_type=payload.report_type,
        period_start=payload.period_start,
        period_end=payload.period_end,
        summary=payload.summary,
        educational_progress=payload.educational_progress,
        quran_progress=payload.quran_progress,
        activities=payload.activities,
        health_status=payload.health_status,
        psychological_status=payload.psychological_status,
        status="pending_partner_approval",
        submitted_by=user.id,
        submitted_at=datetime.now(UTC),
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return ReportRead.model_validate(report)


@router.get(
    "/me/orphans/{orphan_id}/documents",
    response_model=list[DocumentRead],
)
async def list_my_orphan_documents(
    orphan_id: UUID,
    db: DbSession,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[DocumentRead]:
    """List the documents the guardian (or staff) has on file for one of the
    guardian's orphans, newest first, with their ``verification_status`` so the
    G-03 UI can show pending → verified/rejected. Cross-family orphan → 403.
    """
    guardian = await _load_guardian_or_404(db, user)
    await _orphan_in_family_or_error(db, guardian, orphan_id)
    rows = (
        await db.scalars(
            select(Document)
            .where(Document.orphan_id == orphan_id)
            .order_by(Document.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [DocumentRead.model_validate(r) for r in rows]


@router.post(
    "/me/orphans/{orphan_id}/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_my_orphan_document(
    orphan_id: UUID,
    db: DbSession,
    user: CurrentUser,
    file: Annotated[UploadFile, File()],
    document_type: Annotated[DocumentType, Form()],
    title: Annotated[str | None, Form()] = None,
) -> DocumentRead:
    """Guardian uploads/refreshes a document for their orphan (G-03
    "تحديث المستندات").

    One call: the bytes are streamed to the private bucket and a ``documents``
    row is created in ``verification_status='pending'`` — it is **never**
    auto-verified, and rides the existing staff verification workflow
    (``POST /documents/{id}/verify``). Ownership is checked *before* any byte
    is read or stored, so a cross-family attempt (403) or a non-guardian (404)
    never touches object storage.
    """
    guardian = await _load_guardian_or_404(db, user)
    orphan = await _orphan_in_family_or_error(db, guardian, orphan_id)

    if file.content_type not in _GUARDIAN_DOC_MIME:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Allowed types: {sorted(_GUARDIAN_DOC_MIME)}",
        )
    body = await file.read()
    if len(body) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty upload")
    if len(body) > settings.UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Max upload is {settings.UPLOAD_MAX_BYTES} bytes",
        )

    bucket = settings.S3_BUCKET_PRIVATE
    await ensure_bucket(bucket)
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "bin"
    key = f"documents/{user.organization_id}/{uuid4().hex}.{ext}"
    await put_object(
        bucket, key, body, content_type=file.content_type or "application/octet-stream"
    )

    doc = Document(
        organization_id=user.organization_id,
        orphan_id=orphan.id,
        family_id=orphan.family_id,
        document_type=document_type,
        title=title,
        file_url=f"s3://{bucket}/{key}",
        file_name=file.filename,
        file_size_bytes=len(body),
        file_mime_type=file.content_type,
        verification_status="pending",
        uploaded_by=user.id,
    )
    db.add(doc)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="document.attached",
        entity_type="document",
        entity_id=doc.id,
        new_values={
            "orphan_id": str(orphan.id),
            "document_type": doc.document_type,
            "file_name": doc.file_name,
            "via": "guardian_self",
        },
    )
    await db.commit()
    await db.refresh(doc)
    return DocumentRead.model_validate(doc)
