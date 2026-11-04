# Runbook: backups and restore drill

## What protects the data

| Layer | What | Recovers from |
|-------|------|---------------|
| Supabase daily backups | Whole database, kept 7 days (Pro) | Loss of the project |
| Supabase point-in-time recovery | Write-ahead log, to the second | Bad migration, bulk mistake: restore to just before it |
| `scripts/backup.sh` (weekly + before every release) | `pg_dump` of public, private, auth, storage metadata and vault, encrypted with `age` and kept off Supabase | Supabase account problems; a copy we control |
| Storage bucket (attachments) | Supabase Storage, replicated by Supabase | Not in the dump: export with `supabase storage cp` monthly |

**Targets:** lose at most 5 minutes of data (RPO, with PITR). Be back within 4 hours (RTO).

## Weekly backup

```bash
BACKUP_DATABASE_URL='postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres' \
AGE_RECIPIENT='age1…' scripts/backup.sh /secure/backups/scaler
```

- Keep 8 weekly and 12 monthly copies.
- The age private key lives in the company password manager, not on the backup machine.

## Restore drill (quarterly, and before go-live)

1. Decrypt the newest backup: `age -d -i key.txt scaler-<stamp>.dump.age > scaler.dump`.
2. Start a scratch Postgres 15+ (local Docker is fine): `docker run -d -p 55432:5432 -e POSTGRES_PASSWORD=drill postgres:17`.
3. Restore into it and compare row counts with production:
   ```bash
   RESTORE_DATABASE_URL=postgresql://postgres:drill@localhost:55432/postgres \
   SOURCE_DATABASE_URL="$BACKUP_DATABASE_URL" scripts/restore-drill.sh scaler.dump
   ```
4. Record in the drill log below:
   - the date;
   - the backup used;
   - the restore time;
   - whether the counts matched. Only rows written after the backup may differ.
5. Drop the scratch database. Delete the decrypted dump.

| Date | Backup | Restore time | Counts | By |
|------|--------|--------------|--------|----|
| _first drill before go-live_ | | | | |

## Restoring for real

- **Point in time (preferred).**
  1. Supabase → Database → Backups → Point in time.
  2. Restore into a **new** project.
  3. Copy the affected rows back with `psql` / `pg_dump --table`.
  4. Or, if the whole database is bad, switch the app's environment variables to the new project and redeploy.
- **From our dump.**
  1. Create a new Supabase project.
  2. Run `supabase db push` to create the schema and roles.
  3. Run `pg_restore --data-only --disable-triggers` with the dump.
  4. Re-upload attachments.
  5. Switch the environment variables.
- **After any restore:**
  - re-run `scripts/smoke-test.sh`;
  - reconnect WhatsApp numbers if the vault didn't restore;
  - tell the tenants what period was lost, if any.
