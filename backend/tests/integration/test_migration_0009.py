"""Migration 0009 — reversibility + ``available_since`` backfill.

Drives Alembic against the test database to prove the migration is fully
reversible (upgrade → downgrade → upgrade) and that the upgrade's backfill
anchors ``available_since`` to ``created_at`` for orphans already sitting in
the available pool.

The whole dance happens inside a single test and always restores the DB to
head (in ``finally``), so the shared test database is left untouched for the
rest of the suite.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from httpx import AsyncClient
from sqlalchemy import text

from app.core.config import settings
from app.core.database import make_session

_BACKEND_DIR = Path(__file__).resolve().parents[2]


def _alembic_config() -> Config:
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))
    return cfg


async def _column_exists(column: str) -> bool:
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'orphans' AND column_name = :c"
                ),
                {"c": column},
            )
        ).first()
    return row is not None


async def test_migration_0009_reversible_and_backfills(
    api: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    test_db_url = os.getenv("RUFAQAA_TEST_DATABASE_URL")
    if not test_db_url:
        pytest.skip("RUFAQAA_TEST_DATABASE_URL not set")

    # Create an orphan and force it into the available pool with a NULL
    # available_since — i.e. exactly the pre-migration shape the backfill
    # is meant to repair.
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"ترحيل-{suffix}",
            "family_name": "حالة",
            "date_of_birth": "2013-02-02",
            "gender": "F",
            "partner_organization_id": (
                await _fetch_one(
                    "SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1"
                )
            ),
            "father_name": f"أب-{suffix}",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    orphan_id = r.json()["id"]

    async with make_session() as db:
        await db.execute(
            text(
                "UPDATE orphans SET case_status = 'available', available_since = NULL "
                "WHERE id = :id"
            ),
            {"id": orphan_id},
        )
        await db.commit()
    created_at = await _fetch_one(
        "SELECT created_at::text FROM orphans WHERE id = :id", {"id": orphan_id}
    )

    # Point Alembic at the test database for the duration of the test.
    monkeypatch.setattr(settings, "DATABASE_URL", test_db_url)
    cfg = _alembic_config()

    try:
        # ── downgrade 0009 → 0008: the three columns disappear ──────────
        command.downgrade(cfg, "0008")
        assert not await _column_exists("available_since")
        assert not await _column_exists("mother_status")
        assert not await _column_exists("priority_level")

        # ── upgrade 0008 → 0009: columns return, backfill runs ──────────
        command.upgrade(cfg, "0009")
        assert await _column_exists("available_since")
        assert await _column_exists("mother_status")
        assert await _column_exists("priority_level")

        # Backfill anchored our available orphan's available_since to created_at.
        backfilled = await _fetch_one(
            "SELECT available_since::text FROM orphans WHERE id = :id",
            {"id": orphan_id},
        )
        assert backfilled is not None
        assert backfilled == created_at
    finally:
        # Always leave the DB at head, whatever happened above.
        command.upgrade(cfg, "head")


async def _fetch_one(sql: str, params: dict | None = None):  # noqa: ANN202
    async with make_session() as db:
        row = (await db.execute(text(sql), params or {})).first()
    return row[0] if row is not None else None
