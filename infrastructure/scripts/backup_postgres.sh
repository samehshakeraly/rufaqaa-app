#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Rufaqaa — PostgreSQL backup
# ════════════════════════════════════════════════════════════════════
#
# Dumps the configured database to a timestamped .dump file using the
# custom format (--format=custom), optionally uploads it to S3, then
# prunes local backups older than BACKUP_RETAIN_DAYS.
#
# Designed to be cron-friendly: stable exit codes, no interactive
# prompts, logs to stdout. Set environment variables to configure:
#
#   POSTGRES_HOST          default localhost
#   POSTGRES_PORT          default 5432
#   POSTGRES_USER          default rufaqaa
#   POSTGRES_PASSWORD      required (or use .pgpass)
#   POSTGRES_DB            default rufaqaa
#   BACKUP_DIR             default /var/backups/rufaqaa
#   BACKUP_RETAIN_DAYS     default 14
#   BACKUP_S3_BUCKET       optional — if set, also uploads to this bucket
#   BACKUP_S3_PREFIX       default rufaqaa/postgres/
#
# Typical crontab entry (daily at 02:30):
#   30 2 * * * /opt/rufaqaa/infrastructure/scripts/backup_postgres.sh \
#               >> /var/log/rufaqaa-backup.log 2>&1
#
# Restore (rough):
#   pg_restore --clean --if-exists --no-owner -d rufaqaa <file>.dump
# ════════════════════════════════════════════════════════════════════

set -euo pipefail

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-rufaqaa}"
POSTGRES_DB="${POSTGRES_DB:-rufaqaa}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/rufaqaa}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-rufaqaa/postgres/}"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
out_file="${BACKUP_DIR}/rufaqaa-${timestamp}.dump"

mkdir -p "$BACKUP_DIR"

echo "[$(date -uIs)] dumping ${POSTGRES_DB}@${POSTGRES_HOST} -> ${out_file}"
PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_dump \
    --host="$POSTGRES_HOST" \
    --port="$POSTGRES_PORT" \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --file="$out_file"

size=$(du -h "$out_file" | cut -f1)
echo "[$(date -uIs)] dump complete (${size})"

if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
    if ! command -v aws >/dev/null 2>&1; then
        echo "[$(date -uIs)] aws CLI not found; skipping S3 upload" >&2
    else
        s3_key="s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}$(basename "$out_file")"
        echo "[$(date -uIs)] uploading -> ${s3_key}"
        aws s3 cp "$out_file" "$s3_key" --only-show-errors
    fi
fi

echo "[$(date -uIs)] pruning local backups older than ${BACKUP_RETAIN_DAYS} days"
find "$BACKUP_DIR" -name 'rufaqaa-*.dump' -type f \
    -mtime +"$BACKUP_RETAIN_DAYS" -print -delete

echo "[$(date -uIs)] done"
