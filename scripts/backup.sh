#!/usr/bin/env bash
# Takes a restorable backup of the database into backups/crm-<timestamp>.dump.
# Run it before every migration and before deleting sample data.
#   DIRECT_URL="postgresql://..." bash scripts/backup.sh
# Falls back to .env if DIRECT_URL is not already set. Needs pg_dump on the PATH.
set -euo pipefail

if [ -z "${DIRECT_URL:-}" ] && [ -f .env ]; then
  DIRECT_URL="$(grep -E '^DIRECT_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"
fi
: "${DIRECT_URL:?Set DIRECT_URL (the direct, non-pooled connection string)}"

mkdir -p backups
out="backups/crm-$(date +%Y%m%d-%H%M%S).dump"
pg_dump "$DIRECT_URL" -Fc -f "$out"
echo "Backup written to $out ($(du -h "$out" | cut -f1))"
echo "Check it restores: see 'Restore drill' in TECHNICIAN.md."
