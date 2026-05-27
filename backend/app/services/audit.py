"""Helpers to record audit-log entries.

The functions here intentionally don't commit — they just `db.add()` a row.
The calling endpoint commits as part of its own transaction so audit
writes and the business write succeed or fail together.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLogEntry


def record_audit(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID | None,
    action: str,
    entity_type: str,
    entity_id: UUID | None = None,
    old_values: dict[str, Any] | None = None,
    new_values: dict[str, Any] | None = None,
    is_sensitive: bool = False,
) -> AuditLogEntry:
    entry = AuditLogEntry(
        organization_id=organization_id,
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_values=old_values,
        new_values=new_values,
        is_sensitive=is_sensitive,
    )
    db.add(entry)
    return entry
