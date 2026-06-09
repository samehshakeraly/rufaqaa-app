from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class NotificationPreferences(BaseModel):
    """Channel-level toggles for transactional and marketing notifications.

    Stored as JSONB on `users.notification_preferences`; absent keys fall
    back to the defaults below (everything on except marketing)."""

    email: bool = True
    sms: bool = False
    whatsapp: bool = False
    weekly_digest: bool = True
    marketing: bool = False


class NotificationPreferencesUpdate(BaseModel):
    email: bool | None = None
    sms: bool | None = None
    whatsapp: bool | None = None
    weekly_digest: bool | None = None
    marketing: bool | None = None


class CurrentUser(BaseModel):
    id: UUID
    email: EmailStr
    organization_id: UUID
    # The جهة (partner org) this user is scoped to, when their role is
    # partner-scoped (partner_manager / partner_staff). NULL otherwise.
    partner_organization_id: UUID | None = None
    role: str
    first_name: str
    last_name: str
    email_verified_at: datetime | None = None
    notification_preferences: NotificationPreferences = Field(
        default_factory=NotificationPreferences
    )


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    # Same shape whether or not the email exists, to avoid enumeration.
    sent: bool = True
    # Only populated in dev/test, where we don't have an email transport
    # yet. Lets the caller exercise the full flow end-to-end.
    debug_token: str | None = None


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class DonorSignupRequest(BaseModel):
    """Public signup. Email + password + name are required; everything
    else is optional and can be filled later from the profile page."""

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    preferred_currency: str | None = Field(default=None, min_length=3, max_length=3)
    preferred_language: Literal["ar", "en"] = "ar"


class DonorSignupResponse(BaseModel):
    """Anti-enumeration: the shape is identical whether the email is
    brand-new or already on file. The detail string says 'check your
    email' in both cases. Only the verification token is omitted on the
    already-registered branch."""

    detail: str
    # Only present in non-production environments so the e2e suite can
    # follow the verification link without an SMTP server.
    debug_verify_token: str | None = None


class EmailVerifyRequest(BaseModel):
    token: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr
