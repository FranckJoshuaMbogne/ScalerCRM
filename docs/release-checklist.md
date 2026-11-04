# v1.0 release checklist

Nineteen items, all checked before MY PERFECT FIT moves onto production. Record who checked each item and when. The PRD's own M6 checklist wasn't in the repository; this list covers what SPRINTS.md asks of Sprint 9, plus the go-live steps in the runbooks.

| # | Item | How it's verified | Done (who, date) |
|---|------|-------------------|------------------|
| 1 | All sprint PRs merged to `main`, CI green | GitHub: `main` checks | |
| 2 | SQL suite passes, including the security audit (`99_security_audit.sql`) | CI "Migrations and RLS tests" | |
| 3 | Load test run on the release candidate; no query over budget | `scripts/load-test.sh`, results in docs/load-test.md | |
| 4 | Security checklist reviewed; Supabase advisors show no security warnings | docs/runbooks/security-checklist.md; Supabase → Advisors | |
| 5 | Dependabot alerts on; `npm audit --omit=dev` shows no high or critical | GitHub settings; terminal | |
| 6 | Production Supabase: Mumbai region, PITR on, MFA for dashboard users, auth settings per runbook | docs/runbooks/deploy.md "Before the first release" step 2 | |
| 7 | Production Vercel: every env var set, server secrets not `NEXT_PUBLIC_` | Vercel → Settings → Environment variables | |
| 8 | Domain and HTTPS live; `NEXT_PUBLIC_SITE_URL` matches | Browser; `scripts/smoke-test.sh` | |
| 9 | Scheduler calls the job route every 5 minutes; `/api/health` says `jobs: ok` | `/api/health` | |
| 10 | Sentry receives a test error; alert rules set | docs/runbooks/monitoring.md | |
| 11 | Uptime monitor on `/api/health`, paging the on-call phone | Monitor dashboard; test page | |
| 12 | Backup taken and a restore drill passed in the last 30 days | Drill log in docs/runbooks/backup-restore.md | |
| 13 | Meta app live: WhatsApp and Lead Ads webhooks verified against production | Meta dashboard; a test lead from the Lead Ads testing tool | |
| 14 | MY PERFECT FIT WhatsApp number connected; a template approved; a test message sent and received | Integrations page | |
| 15 | PWA installs on Android (Chrome) and iPhone (Safari, "Add to Home Screen"); phone notifications arrive; offline page shows today's tasks | Two real phones | |
| 16 | MY PERFECT FIT data imported and reconciled (counts and totals match) | docs/runbooks/my-perfect-fit-migration.md §3 | |
| 17 | Staff trained: admins, sales, store; quick reference shared | docs/training; attendance list | |
| 18 | Smoke test passes against production | `scripts/smoke-test.sh https://app.<domain>` | |
| 19 | Go/no-go signed off by Springs 360 and MY PERFECT FIT; rollback plan read | Meeting note | |
