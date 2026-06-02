"""Documents — file attachments scoped to an orphan.

The actual bytes live in object storage; this endpoint manages the
metadata row (type, title, file_url, verification status, etc).
Callers upload the file separately via /media first."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession
from app.core.authz import ADMIN_ROLES, STAFF_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.document import Document
from app.models.family import Guardian
from app.models.orphan import Orphan
from app.models.user import User
from app.schemas.common import Page
from app.schemas.document import DocumentCreate, DocumentRead, DocumentUrlRead, DocumentVerify
from app.services.audit import record_audit
from app.services.storage import presigned_get_url

router = APIRouter()


async def _load_orphan_or_404(db: AsyncSession, orphan_id: UUID) -> Orphan:
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    return orphan


@router.get("/orphans/{orphan_id}/documents", response_model=Page[DocumentRead])
async def list_orphan_documents(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[DocumentRead]:
    await _load_orphan_or_404(db, orphan_id)
    _ = user
    stmt = (
        select(Document).where(Document.orphan_id == orphan_id).order_by(desc(Document.created_at))
    )
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (await db.scalars(stmt.limit(limit).offset(offset))).all()
    return Page(
        items=[DocumentRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/orphans/{orphan_id}/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def attach_document_to_orphan(
    orphan_id: UUID,
    payload: DocumentCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> DocumentRead:
    orphan = await _load_orphan_or_404(db, orphan_id)
    doc = Document(
        organization_id=orphan.organization_id,
        orphan_id=orphan.id,
        document_type=payload.document_type,
        title=payload.title,
        description=payload.description,
        file_url=payload.file_url,
        file_name=payload.file_name,
        file_size_bytes=payload.file_size_bytes,
        file_mime_type=payload.file_mime_type,
        file_hash=payload.file_hash,
        issue_date=payload.issue_date,
        expiry_date=payload.expiry_date,
        issuing_authority=payload.issuing_authority,
        verification_status="pending",
        uploaded_by=user.id,
    )
    db.add(doc)
    await db.flush()
    record_audit(
        db,
        organization_id=orphan.organization_id,
        user_id=user.id,
        action="document.attached",
        entity_type="document",
        entity_id=doc.id,
        new_values={
            "orphan_id": str(orphan.id),
            "document_type": doc.document_type,
            "file_name": doc.file_name,
        },
    )
    await db.commit()
    await db.refresh(doc)
    return DocumentRead.model_validate(doc)


@router.get("/guardians/{guardian_id}/documents", response_model=Page[DocumentRead])
async def list_guardian_documents(
    guardian_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[DocumentRead]:
    guardian = await db.scalar(select(Guardian).where(Guardian.id == guardian_id))
    if guardian is None:
        raise NotFound("Guardian")
    _ = user
    stmt = (
        select(Document)
        .where(Document.guardian_id == guardian_id)
        .order_by(desc(Document.created_at))
    )
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (await db.scalars(stmt.limit(limit).offset(offset))).all()
    return Page(
        items=[DocumentRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/guardians/{guardian_id}/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def attach_document_to_guardian(
    guardian_id: UUID,
    payload: DocumentCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> DocumentRead:
    guardian = await db.scalar(select(Guardian).where(Guardian.id == guardian_id))
    if guardian is None:
        raise NotFound("Guardian")
    doc = Document(
        organization_id=guardian.organization_id,
        guardian_id=guardian.id,
        family_id=guardian.family_id,
        document_type=payload.document_type,
        title=payload.title,
        description=payload.description,
        file_url=payload.file_url,
        file_name=payload.file_name,
        file_size_bytes=payload.file_size_bytes,
        file_mime_type=payload.file_mime_type,
        file_hash=payload.file_hash,
        issue_date=payload.issue_date,
        expiry_date=payload.expiry_date,
        issuing_authority=payload.issuing_authority,
        verification_status="pending",
        uploaded_by=user.id,
    )
    db.add(doc)
    await db.flush()
    record_audit(
        db,
        organization_id=guardian.organization_id,
        user_id=user.id,
        action="document.attached",
        entity_type="document",
        entity_id=doc.id,
        new_values={
            "guardian_id": str(guardian.id),
            "document_type": doc.document_type,
            "file_name": doc.file_name,
        },
    )
    await db.commit()
    await db.refresh(doc)
    return DocumentRead.model_validate(doc)


@router.post(
    "/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_unattached_document(
    payload: DocumentCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> DocumentRead:
    """Create a documents row without an orphan/guardian/family link.

    Used by flows that need a `document_id` to attach elsewhere — e.g.
    bank-transfer confirmation proof, partner-org paperwork. The bytes
    must already be in object storage via POST /media/file."""
    doc = Document(
        organization_id=user.organization_id,
        document_type=payload.document_type,
        title=payload.title,
        description=payload.description,
        file_url=payload.file_url,
        file_name=payload.file_name,
        file_size_bytes=payload.file_size_bytes,
        file_mime_type=payload.file_mime_type,
        file_hash=payload.file_hash,
        issue_date=payload.issue_date,
        expiry_date=payload.expiry_date,
        issuing_authority=payload.issuing_authority,
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
        new_values={"document_type": doc.document_type, "file_name": doc.file_name},
    )
    await db.commit()
    await db.refresh(doc)
    return DocumentRead.model_validate(doc)


@router.get("/documents/{document_id}/url", response_model=DocumentUrlRead)
async def get_document_url(
    document_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> DocumentUrlRead:
    """Return a short-lived presigned URL for a document's stored file.

    Gated on STAFF_ROLES — the same roles that already *read* documents
    (list_orphan_documents / list_guardian_documents). Viewing is broader than
    verifying, which stays ADMIN_ROLES-only. Org-scoped: RLS plus an explicit
    organization_id filter, so a document outside the caller's org reads as 404.
    Reuses presigned_get_url, which applies #70's browser-reachable host swap."""
    doc = await db.scalar(
        select(Document).where(
            Document.id == document_id,
            Document.organization_id == user.organization_id,
        )
    )
    if doc is None:
        raise NotFound("Document")
    file_url = doc.file_url
    if not file_url.startswith("s3://"):
        return DocumentUrlRead(url=file_url)
    _, _, rest = file_url.partition("s3://")
    bucket, _, key = rest.partition("/")
    url = await presigned_get_url(bucket, key)
    return DocumentUrlRead(url=url)


@router.post("/documents/{document_id}/verify", response_model=DocumentRead)
async def verify_document(
    document_id: UUID,
    payload: DocumentVerify,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> DocumentRead:
    doc = await db.scalar(select(Document).where(Document.id == document_id))
    if doc is None:
        raise NotFound("Document")
    old_status = doc.verification_status
    doc.verification_status = payload.status
    doc.verification_notes = payload.notes
    doc.verified_by = user.id
    doc.verified_at = datetime.now(UTC)
    record_audit(
        db,
        organization_id=doc.organization_id,
        user_id=user.id,
        action="document.verified",
        entity_type="document",
        entity_id=doc.id,
        old_values={"verification_status": old_status},
        new_values={"verification_status": payload.status},
        is_sensitive=True,
    )
    await db.commit()
    await db.refresh(doc)
    return DocumentRead.model_validate(doc)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> None:
    """Hard delete — the file in object storage is the source of truth
    and is not removed here. Operators handle storage GC out of band."""
    doc = await db.scalar(select(Document).where(Document.id == document_id))
    if doc is None:
        raise NotFound("Document")
    record_audit(
        db,
        organization_id=doc.organization_id,
        user_id=user.id,
        action="document.deleted",
        entity_type="document",
        entity_id=doc.id,
        old_values={
            "document_type": doc.document_type,
            "file_name": doc.file_name,
        },
        is_sensitive=True,
    )
    await db.delete(doc)
    await db.commit()
