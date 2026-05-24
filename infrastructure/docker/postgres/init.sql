-- ═══════════════════════════════════════════════════════════════
-- Rufaqaa Platform — PostgreSQL Initialization Script
-- ═══════════════════════════════════════════════════════════════
-- This script runs automatically when the PostgreSQL container
-- starts for the first time.
--
-- It enables required extensions before any schema is applied.
-- ═══════════════════════════════════════════════════════════════

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Cryptographic functions (for encryption, hashing)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Trigram matching (for fuzzy search)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Geospatial queries (for orphan/family location)
CREATE EXTENSION IF NOT EXISTS "postgis";

-- GIN index support for btree types (improves index performance)
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Verify extensions
SELECT
    extname AS extension,
    extversion AS version
FROM pg_extension
ORDER BY extname;

-- ═══════════════════════════════════════════════════════════════
-- Note: The full schema (docs/technical/01_database_schema.sql)
-- will be applied later via Alembic migrations during Phase 1.
-- ═══════════════════════════════════════════════════════════════
