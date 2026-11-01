#!/usr/bin/env bash
# Applies all migrations to a throwaway database and runs the SQL test suite.
# Usage: DATABASE_URL=postgres://user:pass@host:5432/postgres scripts/db-test.sh
set -euo pipefail
shopt -s nullglob

: "${DATABASE_URL:?DATABASE_URL must point at a disposable Postgres (15+)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="scaler_test_$$"
ADMIN_URL="$DATABASE_URL"
TEST_URL="${DATABASE_URL%/*}/$DB"

cleanup() { psql "$ADMIN_URL" -qc "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql "$ADMIN_URL" -qc "create database $DB"

run() { psql "$TEST_URL" -X -q -v ON_ERROR_STOP=1 -o /dev/null -f "$1" 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  /  /"; }

run "$ROOT/supabase/tests/00_bootstrap_plain_postgres.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$f")"
  run "$f"
done
for f in "$ROOT"/supabase/tests/[1-9]*.sql; do
  echo "test: $(basename "$f")"
  run "$f"
done
