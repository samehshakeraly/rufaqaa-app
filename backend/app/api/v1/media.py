"""Media uploads (orphan photos).

The route accepts multipart/form-data, validates the size and MIME type,
streams it to S3/MinIO, and records a media row. Read-back returns a
short-lived presigned URL so the orphan's photo can be displayed without
exposing the bucket publicly.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, text

from app.api.deps import DbSession
from app.api.scoping import get_in_org_or_404
from app.core.authz import ADMIN_ROLES, STAFF_ROLES, require_roles
from app.core.config import settings
from app.core.exceptions import NotFound
from app.models.media import Media
from app.models.orphan import Orphan
from app.models.user import User
from app.schemas.common import Page
from app.schemas.media import MediaCategory
from app.services.audit import record_audit
from app.services.storage import (
    ensure_bucket,
    presigned_get_url,
    presigned_get_url_for,
    put_object,
)

router = APIRouter()

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
# Quran-recitation audio. Kept narrow, the same way the image/document
# allow-lists are, so the bucket can't become an arbitrary-file dump.
ALLOWED_AUDIO_TYPES = {"audio/mpeg", "audio/mp4", "audio/wav"}

# Which MIME types each donor-library category accepts. Drawings, certificates,
# album photos and portraits are images; recitations are audio.
CATEGORY_ALLOWED_TYPES: dict[str, set[str]] = {
    MediaCategory.drawing.value: ALLOWED_IMAGE_TYPES,
    MediaCategory.certificate.value: ALLOWED_IMAGE_TYPES,
    MediaCategory.album.value: ALLOWED_IMAGE_TYPES,
    MediaCategory.portrait.value: ALLOWED_IMAGE_TYPES,
    MediaCategory.recitation.value: ALLOWED_AUDIO_TYPES,
}

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
    # Org-scoped existence guard — a cross-org orphan id 404s, so a photo can
    # never be attached to (or its existence inferred from) another org's orphan.
    await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))

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
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> list[OrphanPhoto]:
    """Photos attached to an orphan, newest first. Each row carries a
    fresh presigned URL so the UI can render the image without exposing
    the bucket."""
    # Org-scoped existence guard — a cross-org orphan id 404s before any photo
    # is listed; the media query is scoped to the same org for defense-in-depth.
    await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    rows = (
        await db.execute(
            text(
                """
                SELECT id, file_url, file_size_bytes, moderation_status, created_at
                FROM media
                WHERE orphan_id = :orphan
                  AND organization_id = :org
                  AND media_type = 'photo'
                ORDER BY created_at DESC
                """
            ),
            {"orphan": str(orphan_id), "org": str(user.organization_id)},
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
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> dict[str, str]:
    """Return a short-lived presigned URL for an uploaded media object."""
    # Explicit org scope, never RLS — the superuser connection bypasses it. A
    # cross-org media id 404s, so no other org's object URL can be minted.
    row = (
        await db.execute(
            text("SELECT file_url FROM media WHERE id = :id AND organization_id = :org"),
            {"id": str(media_id), "org": str(user.organization_id)},
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
    # Explicit org scope, never RLS — the superuser connection bypasses it. A
    # cross-org media id 404s here, never revealing or moderating another org's item.
    row = (
        await db.execute(
            text(
                """
                SELECT id, moderation_status, visibility
                FROM media
                WHERE id = :id AND organization_id = :org
                """
            ),
            {"id": str(media_id), "org": str(user.organization_id)},
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
             WHERE id = :id AND organization_id = :org
            """
        ),
        {
            "status": new_status,
            "notes": payload.notes,
            "moderator": str(user.id),
            "now": now,
            "visibility": new_visibility,
            "id": str(media_id),
            "org": str(user.organization_id),
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


# ── Categorized orphan-media library (PR-4) ────────────────────────────────────
#
# Staff/manager attach categorized media (drawing/certificate/album/recitation/
# portrait) to an orphan, then control each item. Uploads land private+pending,
# exactly like the photo path; a moderator approves via the existing
# /media/{id}/moderate route, and PATCH below toggles visibility/consent. The
# donor only ever sees an item once it is approved + donor-facing (and, for the
# consent-gated categories, has guardian consent) — enforced server-side in the
# composed donor profile, never here.


class MediaManageRead(BaseModel):
    """Management view of one media row (staff/manager only). Carries a fresh
    presigned ``url`` (+ ``thumbnail_url`` when present) so the PR-5 management UI
    can render it without the bucket being public. The raw ``s3://`` storage key
    is NEVER returned."""

    id: UUID
    orphan_id: UUID
    media_type: str
    category: str | None
    title: str | None
    description: str | None
    display_date: date | None
    duration_seconds: int | None
    width: int | None
    height: int | None
    file_size_bytes: int | None
    moderation_status: str
    visibility: str
    has_guardian_consent: bool
    url: str
    thumbnail_url: str | None
    created_at: datetime


async def _media_manage_read(m: Media) -> MediaManageRead:
    return MediaManageRead(
        id=m.id,
        orphan_id=m.orphan_id,
        media_type=m.media_type,
        category=m.category,
        title=m.title,
        description=m.description,
        display_date=m.display_date,
        duration_seconds=m.duration_seconds,
        width=m.width,
        height=m.height,
        file_size_bytes=m.file_size_bytes,
        moderation_status=m.moderation_status or "pending",
        visibility=m.visibility or "private",
        has_guardian_consent=bool(m.has_guardian_consent),
        url=await presigned_get_url_for(m.file_url),
        thumbnail_url=(await presigned_get_url_for(m.thumbnail_url) if m.thumbnail_url else None),
        created_at=m.created_at,
    )


@router.post(
    "/orphans/{orphan_id}/media",
    response_model=MediaManageRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_orphan_media(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    category: Annotated[MediaCategory, Form()],
    file: Annotated[UploadFile, File()],
    title: Annotated[str | None, Form()] = None,
    description: Annotated[str | None, Form()] = None,
    display_date: Annotated[date | None, Form()] = None,
) -> MediaManageRead:
    """Attach a categorized piece of media to an orphan.

    Lands private + pending (and, for the consent-gated categories, without
    consent) — it cannot reach a donor until a moderator approves it and the
    visibility/consent are set. The MIME allow-list is category-specific (images
    for drawing/certificate/album/portrait, audio for recitation). Same
    size/empty guards and status codes as ``upload_orphan_photo``.
    """
    # Org-scoped existence guard — a cross-org orphan id 404s (no existence leak),
    # so media can never be attached to another org's orphan.
    await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))

    allowed = CATEGORY_ALLOWED_TYPES[category.value]
    if file.content_type not in allowed:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Allowed types for {category.value}: {sorted(allowed)}",
        )

    body = await file.read()
    if len(body) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty upload")
    if len(body) > settings.UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Max upload is {settings.UPLOAD_MAX_BYTES} bytes",
        )

    media_type = "audio" if category == MediaCategory.recitation else "photo"
    bucket = settings.S3_BUCKET_PRIVATE
    await ensure_bucket(bucket)
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "bin"
    key = f"orphans/{orphan_id}/{category.value}/{uuid.uuid4().hex}.{ext}"
    await put_object(
        bucket, key, body, content_type=file.content_type or "application/octet-stream"
    )

    media = Media(
        organization_id=user.organization_id,
        orphan_id=orphan_id,
        media_type=media_type,
        category=category.value,
        title=title,
        description=description,
        display_date=display_date,
        file_url=f"s3://{bucket}/{key}",
        file_size_bytes=len(body),
        visibility="private",
        moderation_status="pending",
        has_guardian_consent=False,
        uploaded_by=user.id,
    )
    db.add(media)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="media.uploaded",
        entity_type="media",
        entity_id=media.id,
        new_values={
            "orphan_id": str(orphan_id),
            "category": category.value,
            "size": len(body),
        },
    )
    await db.commit()
    await db.refresh(media)
    return await _media_manage_read(media)


@router.get("/orphans/{orphan_id}/media", response_model=list[MediaManageRead])
async def list_orphan_media(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    category: Annotated[MediaCategory | None, Query()] = None,
) -> list[MediaManageRead]:
    """Manager view of ALL of an orphan's media — including private/pending —
    newest first, optionally narrowed to one ``category``. Each row carries a
    fresh presigned URL. Explicit org scope (never RLS); a cross-org orphan id
    404s before anything is listed."""
    await get_in_org_or_404(db, Orphan, orphan_id, user, Orphan.deleted_at.is_(None))
    stmt = (
        select(Media)
        .where(Media.orphan_id == orphan_id, Media.organization_id == user.organization_id)
        .order_by(Media.created_at.desc())
    )
    if category is not None:
        stmt = stmt.where(Media.category == category.value)
    rows = (await db.scalars(stmt)).all()
    return [await _media_manage_read(m) for m in rows]


class MediaPatch(BaseModel):
    """PATCH body for one media item. Every field is optional; only the fields
    actually supplied are updated (``exclude_unset``). ``visibility`` is typed as
    a ``Literal`` so an unknown value is rejected with 422 at the boundary."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    description: str | None = None
    display_date: date | None = None
    visibility: Literal["private", "donor_only", "public", "archived"] | None = None
    has_guardian_consent: bool | None = None


@router.patch("/{media_id}", response_model=MediaManageRead)
async def update_media(
    media_id: UUID,
    payload: MediaPatch,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> MediaManageRead:
    """Update a media item's title/description/display_date/visibility/consent.

    Moderation (approve/reject) stays on ``POST /media/{id}/moderate``. Explicit
    org scope (never RLS) — a cross-org media id 404s, so no other org's item can
    be read or mutated."""
    media = await db.scalar(
        select(Media).where(Media.id == media_id, Media.organization_id == user.organization_id)
    )
    if media is None:
        raise NotFound("Media")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        return await _media_manage_read(media)

    old = {
        "title": media.title,
        "description": media.description,
        "display_date": media.display_date.isoformat() if media.display_date else None,
        "visibility": media.visibility,
        "has_guardian_consent": media.has_guardian_consent,
    }
    for name, value in fields.items():
        setattr(media, name, value)
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="media.updated",
        entity_type="media",
        entity_id=media.id,
        old_values={k: old[k] for k in fields if k in old},
        new_values={k: (v.isoformat() if isinstance(v, date) else v) for k, v in fields.items()},
    )
    await db.commit()
    await db.refresh(media)
    return await _media_manage_read(media)
