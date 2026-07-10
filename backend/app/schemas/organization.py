from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OrganizationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name_ar: str
    name_en: str
    org_type: str
    deployment_mode: str
    country_code: str
    timezone: str
    default_language: str
    default_currency: str
    logo_url: str | None
    primary_color: str
    status: str
    subscription_plan: str | None
    subscription_expires_at: datetime | None
    report_cadence_days: int | None = Field(default=None, ge=1, le=366)
    created_at: datetime
    updated_at: datetime


class OrganizationUpdate(BaseModel):
    """Settings an org admin may edit. Code, org_type, and deployment_mode
    are intentionally NOT here — those are platform-level and should not
    drift via the admin UI."""

    name_ar: str | None = Field(default=None, min_length=1, max_length=255)
    name_en: str | None = Field(default=None, min_length=1, max_length=255)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    timezone: str | None = Field(default=None, max_length=50)
    default_language: str | None = Field(default=None, min_length=2, max_length=5)
    default_currency: str | None = Field(default=None, min_length=3, max_length=3)
    logo_url: str | None = Field(default=None, max_length=500)
    primary_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    # None (or omitted) means "use the platform default cadence".
    report_cadence_days: int | None = Field(default=None, ge=1, le=366)
