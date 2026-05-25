from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    """Base class for all ORM models."""


engine = create_async_engine(
    str(settings.DATABASE_URL),
    echo=settings.DB_ECHO,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=True,
)

SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


def make_session() -> AsyncSession:
    """Open a new session using the *current* SessionLocal.

    Use this from callers (deps, scripts, tests) instead of importing
    `SessionLocal` directly, so that tests can swap the factory without
    leaving stale references behind.
    """
    return SessionLocal()


@asynccontextmanager
async def session_scope(
    org_id: UUID | None = None,
) -> AsyncIterator[AsyncSession]:
    """
    Yield a session with the per-request Row-Level Security context set.

    The schema enforces tenant isolation via:
        USING (organization_id = current_setting('app.current_org_id', true)::uuid)

    Setting `app.current_org_id` as a session-local GUC scopes every query
    in this transaction to a single organization.
    """
    async with SessionLocal() as session:
        if org_id is not None:
            await session.execute(
                text("SELECT set_config('app.current_org_id', :v, true)"),
                {"v": str(org_id)},
            )
        yield session


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency — vanilla session without RLS context."""
    async with SessionLocal() as session:
        yield session
