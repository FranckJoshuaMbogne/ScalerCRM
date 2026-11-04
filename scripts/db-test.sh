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

# API contract: real api_* responses must match the OpenAPI schemas (needs npm ci).
if [ -x "$ROOT/node_modules/.bin/vitest" ]; then
  SAMPLES="$(mktemp)"
  psql "$TEST_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/contract_samples.sql" > "$SAMPLES"
  echo "test: api contract (src/modules/api/contract.test.ts)"
  (cd "$ROOT" && API_CONTRACT_SAMPLES="$SAMPLES" node_modules/.bin/vitest run src/modules/api/contract.test.ts --reporter=dot)
  rm -f "$SAMPLES"
else
  echo "skip: api contract (run npm ci first)"
fi
