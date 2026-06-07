from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr


class UserAdminRead(BaseModel):
    """Lean user payload for the admin list view — never includes the
    password hash or the 2FA secret."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    first_name: str
    last_name: str
    role: str
    partner_organization_id: UUID | None
    status: str
    two_factor_enabled: bool
    last_login_at: datetime | None
    created_at: datetime
