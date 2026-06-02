"""Media uploads (orphan photos).

The route accepts multipart/form-data, validates the size and MIME type,
streams it to S3/MinIO, and records a media row. Read-back returns a
short-lived presigned URL so the orphan's photo can be displayed without
exposing the bucket publicly.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, text

from app.api.deps import CurrentUser, DbSession
from app.core.authz import ADMIN_ROLES, STAFF_ROLES, require_roles
from app.core.config import settings
from app.core.exceptions import NotFound
from app.models.orphan import Orphan
from app.models.user import User
from app.schemas.common import Page
from app.services.audit import record_audit
from app.services.storage import ensure_bucket, presigned_get_url, put_object

router = APIRouter()

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}

# Generic-document allow-list. Stays narrow so the bucket doesn't
# become an arbitrary-file dumping ground.
ALLOWED_DOCUMENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
}


class FileUploadResponse(BaseModel):
    """Thin metadata blob the frontend hands straight to
    POST /orphans/{id}/documents (or any other attach endpoint)."""

    file_url: str
    file_name: str
    file_size_bytes: int
    file_mime_type: str


class MediaUploadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    orphan_id: UUID
    media_type: Literal["photo"]
    file_url: str
    file_size_bytes: int
    moderation_status: str
    created_at: datetime


@router.post(
    "/orphans/{orphan_id}/photo",
    response_model=MediaUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_orphan_photo(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    file: Annotated[UploadFile, File()],
) -> MediaUploadResponse:
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Allowed types: {sorted(ALLOWED_IMAGE_TYPES)}",
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
    key = f"orphans/{orphan_id}/{uuid.uuid4().hex}.{ext}"
    await put_object(bucket, key, body, content_type=file.content_type or "image/jpeg")

    # The `media` table lives in the canonical schema; we INSERT directly
    # (no ORM model yet) and let RLS scope by app.current_org_id.
    media_id = uuid.uuid4()
    now = datetime.now(UTC)
    await db.execute(
        text(
            """
            INSERT INTO media
                (id, organization_id, orphan_id, media_type,
                 file_url, file_size_bytes, moderation_status,
                 uploaded_by, created_at)
            VALUES
                (:id, :org, :orphan, 'photo',
                 :url, :size, 'pending',
                 :uploader, :now)
            """
        ),
        {
            "id": str(media_id),
            "org": str(user.organization_id),
            "orphan": str(orphan_id),
            "url": f"s3://{bucket}/{key}",
            "size": len(body),
            "uploader": str(user.id),
            "now": now,
        },
    )
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="media.uploaded",
        entity_type="media",
        entity_id=media_id,
        new_values={"orphan_id": str(orphan_id), "size": len(body)},
    )
    await db.commit()

    return MediaUploadResponse(
        id=media_id,
        orphan_id=orphan_id,
        media_type="photo",
        file_url=f"s3://{bucket}/{key}",
        file_size_bytes=len(body),
        moderation_status="pending",
        created_at=now,
    )


class OrphanPhoto(BaseModel):
    id: UUID
    file_url: str
    presigned_url: str
    file_size_bytes: int
    moderation_status: str
    created_at: datetime


@router.get("/orphans/{orphan_id}/photos", response_model=list[OrphanPhoto])
async def list_orphan_photos(
    orphan_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> list[OrphanPhoto]:
    """Photos attached to an orphan, newest first. Each row carries a
    fresh presigned URL so the UI can render the image without exposing
    the bucket."""
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    rows = (
        await db.execute(
            text(
                """
                SELECT id, file_url, file_size_bytes, moderation_status, created_at
                FROM media
                WHERE orphan_id = :orphan AND media_type = 'photo'
                ORDER BY created_at DESC
                """
            ),
            {"orphan": str(orphan_id)},
        )
    ).all()

    out: list[OrphanPhoto] = []
    for row in rows:
        file_url = str(row[1])
        presigned = file_url
        if file_url.startswith("s3://"):
            _, _, rest = file_url.partition("s3://")
            bucket, _, key = rest.partition("/")
            presigned = await presigned_get_url(bucket, key)
        out.append(
            OrphanPhoto(
                id=row[0],
                file_url=file_url,
                presigned_url=presigned,
                file_size_bytes=int(row[2] or 0),
                moderation_status=str(row[3] or "pending"),
                created_at=row[4],
            )
        )
    return out


@router.post(
    "/file",
    response_model=FileUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_generic_file(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    file: Annotated[UploadFile, File()],
) -> FileUploadResponse:
    """Stage a file in object storage and return its s3:// URL plus
    metadata. The frontend two-step upload-then-attach flow calls this
    first, then passes the returned fields to an endpoint that records
    the attachment (e.g. POST /orphans/{id}/documents)."""
    if file.content_type not in ALLOWED_DOCUMENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Allowed types: {sorted(ALLOWED_DOCUMENT_TYPES)}",
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
    key = f"documents/{user.organization_id}/{uuid.uuid4().hex}.{ext}"
    await put_object(
        bucket, key, body, content_type=file.content_type or "application/octet-stream"
    )
    _ = db  # No DB row written; document/attach endpoints persist the link.
    return FileUploadResponse(
        file_url=f"s3://{bucket}/{key}",
        file_name=file.filename or f"upload.{ext}",
        file_size_bytes=len(body),
        file_mime_type=file.content_type or "application/octet-stream",
    )


@router.get("/{media_id}/url")
async def get_media_presigned_url(
    media_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> dict[str, str]:
    """Return a short-lived presigned URL for an uploaded media object."""
    row = (
        await db.execute(
            text("SELECT file_url FROM media WHERE id = :id"),
            {"id": str(media_id)},
        )
    ).first()
    if row is None:
        raise NotFound("Media")
    file_url: str = row[0]
    if not file_url.startswith("s3://"):
        return {"url": file_url}
    _, _, rest = file_url.partition("s3://")
    bucket, _, key = rest.partition("/")
    url = await presigned_get_url(bucket, key)
    return {"url": url}


# ── Human moderation ───────────────────────────────────────────────────
#
# Uploads land with moderation_status='pending' and visibility='private'.
# A partner_manager or org admin reviews each item and flips it to
# approved/rejected. Approve also bumps visibility to 'donor_only' so
# the sponsoring donor can see the photo — that's the only place in the
# stack that a piece of media becomes viewable outside the staff org.


# Approvers can decide on pending media; partner_staff cannot (they're
# the typical uploader). Same separation as the orphan-case workflow.
MEDIA_MODERATOR_ROLES: tuple[str, ...] = ("partner_manager", *ADMIN_ROLES)


class MediaQueueItem(BaseModel):
    """One row in the moderation queue. Carries a fresh presigned URL so
    the reviewer can render the image without the bucket being public —
    same s3:// → URL handling as list_orphan_photos."""

    id: UUID
    orphan_id: UUID
    media_type: str
    file_url: str
    presigned_url: str
    file_size_bytes: int
    moderation_status: str
    visibility: str
    created_at: datetime


@router.get("", response_model=Page[MediaQueueItem])
async def list_media_queue(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*MEDIA_MODERATOR_ROLES))],
    moderation_status: Literal["pending", "approved", "rejected", "flagged"] = "pending",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[MediaQueueItem]:
    """Moderation queue: media in the caller's organization filtered by
    moderation_status, newest first.

    Gated on MEDIA_MODERATOR_ROLES — only the roles that can act on an item
    (POST /media/{id}/moderate) can see the queue. RLS already scopes media
    by org; we filter on organization_id explicitly too (defense-in-depth).
    """
    bind = {"org": str(user.organization_id), "status": moderation_status}
    total = (
        await db.scalar(
            text(
                """
                SELECT COUNT(*) FROM media
                WHERE organization_id = :org AND moderation_status = :status
                """
            ),
            bind,
        )
    ) or 0
    rows = (
        await db.execute(
            text(
                """
                SELECT id, orphan_id, media_type, file_url, file_size_bytes,
                       moderation_status, visibility, created_at
                FROM media
                WHERE organization_id = :org AND moderation_status = :status
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {**bind, "limit": limit, "offset": offset},
        )
    ).all()

    items: list[MediaQueueItem] = []
    for row in rows:
        file_url = str(row[3])
        presigned = file_url
        if file_url.startswith("s3://"):
            _, _, rest = file_url.partition("s3://")
            bucket, _, key = rest.partition("/")
            presigned = await presigned_get_url(bucket, key)
        items.append(
            MediaQueueItem(
                id=row[0],
                orphan_id=row[1],
                media_type=str(row[2]),
                file_url=file_url,
                presigned_url=presigned,
                file_size_bytes=int(row[4] or 0),
                moderation_status=str(row[5]),
                visibility=str(row[6] or "private"),
                created_at=row[7],
            )
        )
    return Page(items=items, total=int(total), limit=limit, offset=offset)


class MediaModeratePayload(BaseModel):
    decision: Literal["approve", "reject"]
    notes: str | None = None


class MediaModerationRead(BaseModel):
    id: UUID
    moderation_status: str
    moderation_notes: str | None
    moderated_by: UUID | None
    moderated_at: datetime | None
    visibility: str


@router.post("/{media_id}/moderate", response_model=MediaModerationRead)
async def moderate_media(
    media_id: UUID,
    payload: MediaModeratePayload,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*MEDIA_MODERATOR_ROLES))],
) -> MediaModerationRead:
    """Approve or reject a pending media item.

    Approving advances visibility from the private default to
    `donor_only` so sponsoring donors can render the photo; rejecting
    leaves visibility untouched so the item stays hidden.
    """
    row = (
        await db.execute(
            text(
                """
                SELECT id, moderation_status, visibility
                FROM media
                WHERE id = :id
                """
            ),
            {"id": str(media_id)},
        )
    ).first()
    if row is None:
        raise NotFound("Media")

    old_status = str(row[1])
    old_visibility = str(row[2])

    if old_status not in ("pending", "flagged"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Media is in moderation_status '{old_status}', "
                "expected one of ['flagged', 'pending']"
            ),
        )

    new_status = "approved" if payload.decision == "approve" else "rejected"
    new_visibility = "donor_only" if payload.decision == "approve" else old_visibility
    now = datetime.now(UTC)

    await db.execute(
        text(
            """
            UPDATE media
               SET moderation_status = :status,
                   moderation_notes  = :notes,
                   moderated_by      = :moderator,
                   moderated_at      = :now,
                   visibility        = :visibility
             WHERE id = :id
            """
        ),
        {
            "status": new_status,
            "notes": payload.notes,
            "moderator": str(user.id),
            "now": now,
            "visibility": new_visibility,
            "id": str(media_id),
        },
    )
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="media.moderated",
        entity_type="media",
        entity_id=media_id,
        old_values={"moderation_status": old_status, "visibility": old_visibility},
        new_values={
            "moderation_status": new_status,
            "visibility": new_visibility,
            "decision": payload.decision,
        },
    )
    await db.commit()

    return MediaModerationRead(
        id=media_id,
        moderation_status=new_status,
        moderation_notes=payload.notes,
        moderated_by=user.id,
        moderated_at=now,
        visibility=new_visibility,
    )
