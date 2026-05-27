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
    role: str
    first_name: str
    last_name: str
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
