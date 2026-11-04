#!/usr/bin/env bash
# Load test: builds a throwaway database from the migrations, seeds 100k customers,
# 150k leads, 60k orders and a 60k-recipient campaign, then times the busiest queries.
# Usage: DATABASE_URL=postgres://user:pass@host:5432/postgres scripts/load-test.sh [--keep]
# Never run against production: it creates and drops its own database.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point at a disposable Postgres (15+)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="scaler_load_$$"
ADMIN_URL="$DATABASE_URL"
LOAD_URL="${DATABASE_URL%/*}/$DB"

cleanup() { [[ "${1:-}" == "--keep" ]] || psql "$ADMIN_URL" -qc "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap 'cleanup "${KEEP:-}"' EXIT
[[ "${1:-}" == "--keep" ]] && KEEP=--keep && echo "keeping database $DB"

psql "$ADMIN_URL" -qc "create database $DB"
run() { psql "$LOAD_URL" -X -q -v ON_ERROR_STOP=1 -f "$1" 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  /  /" | { grep -v '^  ok - ' || true; }; }

run "$ROOT/supabase/tests/00_bootstrap_plain_postgres.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do run "$f" >/dev/null; done
start=$(date +%s)
run "$ROOT/scripts/load/seed.sql"
echo "seeded in $(( $(date +%s) - start ))s"
run "$ROOT/scripts/load/bench.sql"
