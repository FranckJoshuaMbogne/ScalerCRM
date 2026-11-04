#!/usr/bin/env bash
# Logical backup of the SCALER database (schema + data), in pg_dump's custom format.
# This is the off-site copy on top of Supabase's own daily backups / PITR
# (docs/runbooks/backup-restore.md). Run from a trusted machine; the file holds customer data.
#
# Usage: BACKUP_DATABASE_URL=postgres://… scripts/backup.sh [output-dir]
#   BACKUP_DATABASE_URL: Supabase → Project settings → Database → connection string (session pooler or direct),
#                        for a role that can read every schema (postgres).
#   AGE_RECIPIENT (optional): an age public key; when set the dump is encrypted and the plain file removed.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL to the database connection string}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/scaler-$STAMP.dump"

# auth and storage hold sign-in and attachment metadata; vault holds provider tokens (encrypted at rest).
pg_dump "$BACKUP_DATABASE_URL" --format=custom --no-owner --no-privileges \
  --schema=public --schema=private --schema=auth --schema=storage --schema=vault \
  --file="$FILE"
pg_restore --list "$FILE" >/dev/null   # fails if the archive is unreadable
sha256sum "$FILE" > "$FILE.sha256"

if [[ -n "${AGE_RECIPIENT:-}" ]]; then
  age --recipient "$AGE_RECIPIENT" --output "$FILE.age" "$FILE"
  rm -f "$FILE"
  echo "backup: $FILE.age"
else
  echo "backup: $FILE (unencrypted: store it somewhere access-controlled)"
fi
