"""Schemas for the super-admin platform API (B-6).

These power cross-organization (platform-level) views and mutations that
only the `super_admin` role may touch.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

ORG_TYPES = Literal[
    "standalone",
    "external_marketer",
    "local_partner",
    "hybrid",
    "federated",
]
DEPLOYMENT_MODES = Literal["self_hosted", "saas_cloud"]
ORG_STATUSES = Literal["active", "suspended", "archived", "pending_approval"]


class PlatformOrgSummary(BaseModel):
    """One row in the platform org list, with joined tenant counts."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name_ar: str
    name_en: str
    country_code: str
    status: str
    subscription_plan: str | None
    created_at: datetime
    total_orphans: int = 0
    total_donors: int = 0
    total_sponsorships: int = 0


class PlatformOrgDetail(PlatformOrgSummary):
    """Full org record + counts + creation/audit metadata."""

    org_type: str
    deployment_mode: str
    timezone: str
    default_language: str
    default_currency: str
    subscription_expires_at: datetime | None
    settings: dict[str, Any]
    created_by: UUID | None
    updated_at: datetime


class PlatformOrgCreate(BaseModel):
    """Create a new tenant org plus its initial org_admin user."""

    code: str = Field(min_length=2, max_length=20)
    name_ar: str = Field(min_length=1, max_length=255)
    name_en: str = Field(min_length=1, max_length=255)
    country_code: str = Field(min_length=2, max_length=2)
    default_currency: str = Field(default="KWD", min_length=3, max_length=3)
    org_type: ORG_TYPES = "standalone"
    deployment_mode: DEPLOYMENT_MODES = "self_hosted"

    # Initial org_admin provisioned alongside the org.
    admin_email: EmailStr
    admin_password: str = Field(min_length=8, max_length=128)
    admin_first_name: str = Field(default="Org", min_length=1, max_length=100)
    admin_last_name: str = Field(default="Admin", min_length=1, max_length=100)


class CreatedAdmin(BaseModel):
    id: UUID
    email: str


class PlatformOrgCreateResponse(BaseModel):
    organization: PlatformOrgDetail
    admin_user: CreatedAdmin


class PlatformOrgUpdate(BaseModel):
    """Platform-level org edits (status, plan, expiry, free-form settings)."""

    status: ORG_STATUSES | None = None
    subscription_plan: str | None = Field(default=None, max_length=20)
    subscription_expires_at: datetime | None = None
    settings: dict[str, Any] | None = None


class SuspendRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


# ── Platform-wide analytics ──────────────────────────────────────────


class CurrencyTotal(BaseModel):
    currency: str
    total: Decimal


class PlatformSummary(BaseModel):
    total_orgs: int
    active_orgs: int
    total_orphans: int
    total_donors: int
    total_sponsorships: int
    # Converted total uses payments.amount_in_default_currency where the
    # converted figure is available; per-currency breakdown is always
    # returned so nothing is silently dropped.
    total_donated_converted: Decimal
    total_donated_by_currency: list[CurrencyTotal]


class PlatformMonthlyPoint(BaseModel):
    month: datetime
    payments_total: Decimal
    payments_count: int


class PlatformTimeseries(BaseModel):
    months: list[PlatformMonthlyPoint]


class OrgRanking(BaseModel):
    organization_id: UUID
    code: str
    name_ar: str
    name_en: str
    sponsorships_count: int
    donations_total: Decimal


class PlatformByOrg(BaseModel):
    limit: int
    items: list[OrgRanking]


class PlatformHeadline(BaseModel):
    # AVG(end_date - start_date) over ended sponsorships, whole days; None
    # when no sponsorship has ended yet.
    avg_sponsorship_duration_days: int | None
    # In-platform DONOR ACTIVATION: share of non-deleted donors that created
    # at least one sponsorship. 0..1; 0.0 when there are no donors. This is
    # NOT a visitor→donor figure — the platform has no visitor tracking.
    donor_conversion_rate: float


class PlatformFunnel(BaseModel):
    # Honest in-platform donor-activation funnel (registered → sponsored →
    # active). No visitor/event source exists, so the funnel starts at the
    # registered donor, not a site visit.
    registered_donors: int
    donors_with_sponsorship: int
    donors_with_active_sponsorship: int


class PaymentMethodSlice(BaseModel):
    method: str
    count: int
    total: Decimal


class PlatformPaymentMethods(BaseModel):
    items: list[PaymentMethodSlice]


# ── Platform settings ────────────────────────────────────────────────


class PlatformSettingsRead(BaseModel):
    settings: dict[str, Any]
    updated_at: datetime | None
    updated_by: UUID | None


class PlatformSettingsUpdate(BaseModel):
    """Shallow-merged into the existing settings JSONB."""

    settings: dict[str, Any]
