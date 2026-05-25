from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PartnerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name_ar: str
    name_en: str | None
    country_code: str
    status: str
    created_at: datetime
