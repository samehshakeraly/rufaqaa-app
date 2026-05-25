from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    organization_id: UUID
    user_id: UUID | None
    action: str
    entity_type: str
    entity_id: UUID | None
    old_values: dict | None
    new_values: dict | None
    is_sensitive: bool
    created_at: datetime
