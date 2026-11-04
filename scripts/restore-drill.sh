#!/usr/bin/env bash
# Restore drill: restores a backup into a SCRATCH database and compares row counts
# with the source. Never point RESTORE_DATABASE_URL at production.
#
# Usage: RESTORE_DATABASE_URL=postgres://…/postgres SOURCE_DATABASE_URL=postgres://… \
#        scripts/restore-drill.sh backups/scaler-<stamp>.dump
set -euo pipefail

DUMP="${1:?path to a .dump file (decrypt .age files first)}"
: "${RESTORE_DATABASE_URL:?scratch Postgres server URL (its /postgres database)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="scaler_restore_$(date +%s)"
TARGET="${RESTORE_DATABASE_URL%/*}/$DB"

if [[ "$RESTORE_DATABASE_URL" == *supabase.co* && "${I_KNOW_THIS_IS_SCRATCH:-}" != "yes" ]]; then
  echo "RESTORE_DATABASE_URL looks like a Supabase project. Restore into a scratch server, or set I_KNOW_THIS_IS_SCRATCH=yes." >&2
  exit 1
fi

start=$(date +%s)
psql "$RESTORE_DATABASE_URL" -qc "create database $DB"
# Roles Supabase grants to; harmless if they already exist.
psql "$TARGET" -q -c "do \$\$ begin
  create role anon nologin; exception when duplicate_object then null; end \$\$;" \
  -c "do \$\$ begin create role authenticated nologin; exception when duplicate_object then null; end \$\$;" \
  -c "do \$\$ begin create role service_role nologin; exception when duplicate_object then null; end \$\$;"
pg_restore --dbname="$TARGET" --no-owner --no-privileges --exit-on-error "$DUMP" || {
  echo "restore failed; scratch database $DB left for inspection" >&2
  exit 1
}
echo "restored into $DB in $(( $(date +%s) - start ))s"

psql "$TARGET" -X -q -f "$ROOT/scripts/sql/sanity-counts.sql" > /tmp/restore-counts.txt
cat /tmp/restore-counts.txt
if [[ -n "${SOURCE_DATABASE_URL:-}" ]]; then
  psql "$SOURCE_DATABASE_URL" -X -q -f "$ROOT/scripts/sql/sanity-counts.sql" > /tmp/source-counts.txt
  if diff -u /tmp/source-counts.txt /tmp/restore-counts.txt; then
    echo "counts match the source"
  else
    echo "counts differ (expected only for rows written after the backup was taken)"
  fi
fi
echo "Drop the scratch database when done: psql \"$RESTORE_DATABASE_URL\" -c 'drop database $DB'"
