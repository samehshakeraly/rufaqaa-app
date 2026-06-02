from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

DocumentType = Literal[
    "birth_certificate",
    "death_certificate",
    "national_id",
    "passport",
    "bank_statement",
    "school_certificate",
    "medical_report",
    "photo_id",
    "family_record",
    "other",
]

VerificationStatus = Literal["pending", "verified", "rejected", "expired"]


class DocumentCreate(BaseModel):
    """Caller has already uploaded the file to S3 / MinIO (via the
    existing /media endpoint) and is now registering its metadata."""

    document_type: DocumentType
    file_url: str = Field(min_length=1, max_length=500)
    title: str | None = Field(default=None, max_length=255)
    description: str | None = None
    file_name: str | None = Field(default=None, max_length=255)
    file_size_bytes: int | None = Field(default=None, ge=0)
    file_mime_type: str | None = Field(default=None, max_length=100)
    file_hash: str | None = Field(default=None, max_length=64)
    issue_date: date | None = None
    expiry_date: date | None = None
    issuing_authority: str | None = Field(default=None, max_length=255)


class DocumentVerify(BaseModel):
    status: VerificationStatus
    notes: str | None = None


class DocumentUrlRead(BaseModel):
    """Short-lived presigned URL for viewing a document's stored file."""

    url: str


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    orphan_id: UUID | None
    document_type: DocumentType
    title: str | None
    description: str | None
    file_url: str
    file_name: str | None
    file_size_bytes: int | None
    file_mime_type: str | None
    issue_date: date | None
    expiry_date: date | None
    issuing_authority: str | None
    verification_status: VerificationStatus
    verified_at: datetime | None
    uploaded_by: UUID | None
    created_at: datetime
