"""Integration test fixtures.

These tests require a real PostgreSQL instance with the canonical schema
applied. Set RUFAQAA_TEST_DATABASE_URL to enable them; otherwise they are
skipped (so `pytest` still passes without Docker).

Recommended workflow:

    # 1. Spin up postgres
    docker compose up -d postgres

    # 2. Apply schema (Alembic loads docs/technical/01_database_schema.sql)
    cd backend
    DATABASE_URL=postgresql+asyncpg://rufaqaa:rufaqaa_dev_password@localhost:5432/rufaqaa \\
        alembic upgrade head

    # 3. Run integration tests against the same DB
    RUFAQAA_TEST_DATABASE_URL=postgresql+asyncpg://rufaqaa:rufaqaa_dev_password@localhost:5432/rufaqaa \\
        pytest tests/integration -v
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import database as db_module
from app.main import app
from app.scripts.seed import (
    SEED_ADMIN_EMAIL,
    SEED_ADMIN_PASSWORD,
    seed,
)

TEST_DB_URL = os.getenv("RUFAQAA_TEST_DATABASE_URL")


@pytest.fixture(scope="session")
def _test_db_url() -> str:
    if not TEST_DB_URL:
        pytest.skip("RUFAQAA_TEST_DATABASE_URL not set; skipping integration tests")
    return TEST_DB_URL


@pytest.fixture(scope="session")
async def _engine(_test_db_url: str):
    engine = create_async_engine(_test_db_url, future=True)
    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False)

    original_engine = db_module.engine
    original_session = db_module.SessionLocal
    db_module.engine = engine
    db_module.SessionLocal = session_factory

    try:
        await seed()
        yield engine
    finally:
        db_module.engine = original_engine
        db_module.SessionLocal = original_session
        await engine.dispose()


@pytest.fixture
async def api(_engine) -> AsyncIterator[AsyncClient]:  # noqa: ANN001
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def token(api: AsyncClient) -> str:
    r = await api.post(
        "/api/v1/auth/login",
        json={"email": SEED_ADMIN_EMAIL, "password": SEED_ADMIN_PASSWORD},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture
async def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
