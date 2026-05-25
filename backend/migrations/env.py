"""Alembic environment using a synchronous psycopg engine.

The first migration (`0001_initial_schema.py`) applies the canonical SQL
schema in `docs/technical/01_database_schema.sql`, which contains multiple
statements, PL/pgSQL trigger bodies, and dollar-quoted strings. The asyncpg
driver wraps each call as a prepared statement and refuses multi-statement
SQL, so migrations run through psycopg (sync) instead.

The app itself uses asyncpg at runtime (see app/core/database.py).
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlalchemy.engine import Connection

from app.core.config import settings
from app.core.database import Base
from app.models import *  # noqa: F401,F403

config = context.config


def _sync_url() -> str:
    url = str(settings.DATABASE_URL)
    return url.replace("+asyncpg", "+psycopg").replace(
        "postgresql://", "postgresql+psycopg://"
    )


config.set_main_option("sqlalchemy.url", _sync_url())

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        do_run_migrations(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
