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
8. **Billing (Sprint 11, ADR 0012).**
   - In Platform → Billing, enter Springs 360's legal name, GSTIN, address and invoice prefix. Until then every invoice is a test invoice.
   - In Platform → Plans, set the monthly and yearly prices (before GST).
   - In the Razorpay dashboard, enable Subscriptions and add the webhook `https://app.<domain>/api/webhooks/billing/razorpay` with the events listed in `.env.example`. Set `RAZORPAY_WEBHOOK_SECRET` to its secret.
   - Run the whole lifecycle with `rzp_test_` keys on a preview first: subscribe, renew, fail a renewal, let grace run out, pay again, cancel.
   - Switch to `rzp_live_` keys only after Springs 360's GST registration is entered. Reconcile the first settlement report in Platform → Billing.
9. **Self-serve sign-up (Sprint 12, ADR 0013).**
   - In Supabase Auth, keep "Confirm email" on, and set the site URL and redirect URLs to `https://app.<domain>/auth/callback`.
   - Set `SIGNUP_HASH_SALT` to a random string.
   - Check Platform → Signups daily for WhatsApp numbers waiting for review.
   - Businesses Springs 360 sets up by hand: clear the trial date in the platform console so they are billed by hand.
10. **Public API and webhooks (Sprint 13, ADR 0014).**
    - Nothing to configure. Webhooks go out with the existing job route; check its heartbeat shows `outboundWebhooks`.
    - Migration `20270517000000` builds four indexes on customers, leads, orders and payments. They block writes to those tables while they build: a few seconds at MY PERFECT FIT's size. Ship it in the evening window.
    - Existing API keys become `leads:write` keys, so website forms keep working. Check one form submission after the release.
    - The public reference is at `/developers`. Tell partners about `/api/v1/openapi.json` and the Postman collection.
11. **Branch reporting (Sprint 15, ADR 0016).**
    - Nothing to configure. After the release, the job route fills the analytics rollups 60 days a pass, so the history is done within a few passes. `refresh_analytics_rollups` appears as `rollups` in the job heartbeat.
    - Migration `20270614000000` adds indexes on walk-ins and appointments, which are small tables.
12. **White-label (Sprint 16, ADR 0017).**
    - Create a Vercel token that can manage this project's domains. Set `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID` and, for a team, `VERCEL_TEAM_ID`. Without them, tenants' domains are added to the project by hand.
    - Branded senders use the existing `RESEND_API_KEY`. The Resend plan must allow as many domains as white-label tenants.
    - Check after each release: `scripts/white-label-check.sh` (two tenants on two domains, no brand or cookie leakage).

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
