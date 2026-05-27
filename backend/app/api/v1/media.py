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

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, text

from app.api.deps import CurrentUser, DbSession
from app.core.authz import STAFF_ROLES, require_roles
from app.core.config import settings
from app.core.exceptions import NotFound
from app.models.orphan import Orphan
from app.models.user import User
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
