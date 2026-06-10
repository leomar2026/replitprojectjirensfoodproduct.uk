#!/bin/bash
# Database backup script for Jiren's Food Product
# Usage: bash scripts/backup-db.sh
# Add to cron: 0 2 * * * /path/to/app/scripts/backup-db.sh >> /var/log/jirens/backup.log 2>&1

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$APP_DIR/.env" ]; then
    export $(grep -v '^#' "$APP_DIR/.env" | xargs)
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/jirens}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/jirens_backup_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup..."

if [ -n "$DATABASE_URL" ]; then
    pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"
else
    PGPASSWORD="$PGPASSWORD" pg_dump \
        -h "${PGHOST:-localhost}" \
        -p "${PGPORT:-5432}" \
        -U "${PGUSER:-postgres}" \
        "${PGDATABASE:-jirens_food}" | gzip > "$BACKUP_FILE"
fi

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup saved: $BACKUP_FILE ($SIZE)"

find "$BACKUP_DIR" -name "jirens_backup_*.sql.gz" -mtime +$KEEP_DAYS -delete
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleanup done. Keeping last $KEEP_DAYS days."

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete."
