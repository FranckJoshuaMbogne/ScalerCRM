# Runbook: production deploy

For the first go-live (MY PERFECT FIT) and every release after it. A person runs every step; nothing here is automated in CI.
Record each run in the release checklist ([docs/release-checklist.md](../release-checklist.md)).

## Before the first release (once)

1. **Domain.** Point `app.<domain>` (placeholder `app.scalercrm.com`, see *Decisions to confirm early* in SPRINTS.md) at Vercel. Set `NEXT_PUBLIC_SITE_URL` to it.

2. **Supabase project (production, Pro plan or higher).**
   - Region: Mumbai (`ap-south-1`), closest to the first tenants.
   - Turn on **Point-in-time recovery**. Daily backups alone lose up to a day.
   - Auth → URL configuration: Site URL = the app URL; Redirect URLs = `https://app.<domain>/auth/callback`.
   - Auth → Email: confirm email **on**; custom SMTP (Resend) so auth mail isn't throttled at Supabase's shared limit.
   - Auth → Password security: minimum length 10, leaked-password protection on.
   - Auth → Rate limits: keep the defaults or lower them. These are the sign-in and sign-up limits (ADR 0010 §2).
   - Database → Network restrictions: allow only the IPs that need direct database access (the backup machine). The app talks through the API.
   - Make the people with dashboard access Owners/Admins with **MFA** on. Nobody else gets access.

3. **Vercel project.**
   - Production branch `main`.
   - Environment variables, all from `.env.example`. Server-only values must **not** start with `NEXT_PUBLIC_`:
     - Supabase URL and anon key; `SUPABASE_SERVICE_ROLE_KEY`;
     - `CRON_SECRET` (`openssl rand -hex 32`);
     - `RESEND_API_KEY`, `EMAIL_FROM`;
     - the Meta and Google variables;
     - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`node scripts/generate-vapid-keys.mjs`);
     - `SENTRY_DSN`.
   - Function region: `bom1` (Mumbai), next to the database.

4. **Scheduler.** Call `GET https://app.<domain>/api/cron/tasks` with `Authorization: Bearer $CRON_SECRET` every 5 minutes. Use Vercel Cron (Pro) or Supabase `pg_cron` + `pg_net` (ADR 0004). `/api/health` reports `jobs: stale` within 15 minutes if this stops.

5. **Meta app (Springs 360).**
   - WhatsApp webhook: `https://app.<domain>/api/webhooks/whatsapp`, field `messages`.
   - Page webhook: `https://app.<domain>/api/webhooks/meta/leadgen`, field `leadgen`.
   - Both use the verify token in `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
   - App in **Live** mode, with business verification and app review complete (see SPRINTS.md).

6. **Platform admins.** Make the Springs 360 people who run the platform console admins. This is by hand, on purpose:
   `update public.profiles set is_platform_admin = true where email in ('…');`
   Keep the list short and review it each quarter.
7. **Monitoring.** Follow [monitoring.md](monitoring.md): Sentry alert rules, an uptime check on `/api/health`, and who gets paged.

## Every release

1. **Freeze.** Every change for this release has been merged into `main` with green CI. Tag it: `git tag -a v1.0.0 -m "v1.0.0" && git push origin v1.0.0`.
2. **Read the migrations** being shipped (`git diff <previous tag>..<tag> -- supabase/migrations`). Note any that rewrite large tables.
3. **Back up:** `BACKUP_DATABASE_URL=… scripts/backup.sh`. Confirm Supabase shows a PITR window that covers now.
4. **Dry run:** `PROD_URL=https://app.<domain> scripts/deploy-production.sh`. It runs the checks and lists the migrations it would apply.
5. **Choose the window.** Releases with migrations go out outside shop hours (before 10:00 or after 21:00 IST).
6. **Release:** `scripts/deploy-production.sh --confirm v1.0.0`. It migrates the database, then deploys the app, then runs `scripts/smoke-test.sh`. Migrations always go first: each one is written so the previous app version keeps working on the new schema.
7. **Smoke test as a person.** Sign in as a test admin of the internal "SCALER QA" business and check:
   - open the dashboard;
   - create and archive a lead;
   - check the inbox loads;
   - export a CSV.
8. **Tell the tenants** what changed, using the release notes.
9. **Watch for an hour:**
   - Sentry for new issues;
   - `/api/health`;
   - the Vercel function error rate;
   - Supabase → Reports for slow queries.

## Rolling back

- **App only (no migration in the release):** promote the previous deployment in Vercel. This takes under a minute.
- **A migration broke something:** fix forward with a new migration if at all possible. Migrations are additive (ADR 0001), so the previous app version normally runs on the new schema: roll the app back first, then fix the migration calmly.
- **Data was damaged:** follow [backup-restore.md](backup-restore.md). Restore to a new project with PITR to just before the release, then copy back the affected rows. Never restore over the live project while tenants are writing.
