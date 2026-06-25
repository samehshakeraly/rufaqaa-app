#!/usr/bin/env bash
#
# test-integration.sh — run the backend integration tests against a dedicated,
# schema-migrated test database in one command.
#
# This is LOCAL developer tooling. It assumes the docker-compose stack is up
# (`postgres` and `backend` services running). It is idempotent and safe to
# re-run: it creates the test DB if missing, ensures PostGIS, applies the latest
# Alembic migrations, then runs pytest with RUFAQAA_TEST_DATABASE_URL pointed at
# the test DB (conftest.py skips the integration suite unless that var is set).
#
# Usage:
#   ./scripts/test-integration.sh
#   ./scripts/test-integration.sh tests/integration/test_payments_donor.py
#
set -euo pipefail

# --- Config (override via env) ------------------------------------------------
PG_USER="${POSTGRES_USER:-rufaqaa}"
PG_PASS="${POSTGRES_PASSWORD:-rufaqaa_dev_password}"
TEST_DB="${RUFAQAA_TEST_DB:-rufaqaa_test}"
# Connection string as seen from inside the backend container (host "postgres").
TEST_URL="postgresql+asyncpg://${PG_USER}:${PG_PASS}@postgres:5432/${TEST_DB}"

# Pytest targets: positional args if given, otherwise the whole integration suite.
if [[ $# -gt 0 ]]; then
  TARGETS=("$@")
else
  TARGETS=("tests/integration")
fi

# --- Steps (all via `docker compose exec -T`, no TTY) -------------------------

echo ">> [1/4] Creating test database '${TEST_DB}' (if missing)..."
# createdb fails if the DB already exists; swallow that so the step is idempotent.
docker compose exec -T postgres createdb -U "$PG_USER" "$TEST_DB" 2>/dev/null || true

echo ">> [2/4] Ensuring PostGIS extension on '${TEST_DB}'..."
docker compose exec -T postgres \
  psql -U "$PG_USER" -d "$TEST_DB" -c "CREATE EXTENSION IF NOT EXISTS postgis;"

echo ">> [3/4] Applying Alembic migrations to '${TEST_DB}'..."
docker compose exec -T -e DATABASE_URL="$TEST_URL" backend alembic upgrade head

echo ">> [4/4] Running pytest (${TARGETS[*]})..."
docker compose exec -T -e RUFAQAA_TEST_DATABASE_URL="$TEST_URL" backend pytest "${TARGETS[@]}" -q
