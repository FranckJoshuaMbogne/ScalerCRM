# Runbook: monitoring and alerts

## Signals

| Signal | Where | Alert when | Goes to |
|--------|-------|-----------|---------|
| Uptime | Uptime monitor (e.g. Better Stack, UptimeRobot) on `GET /api/health` every minute | 2 failures in a row (503: database down or jobs stale) | On-call phone + #scaler-ops |
| Server errors | Sentry project `scaler` (`SENTRY_DSN`) | New issue; or > 20 events in 10 min | #scaler-ops; on-call if it's the error-rate rule |
| Background jobs | `/api/health` `jobs` field, from the `task_jobs` heartbeat | Not `ok` for 15 minutes (covered by the uptime check) | Same as uptime |
| WhatsApp health | Integrations page per business; `whatsapp_health()` | Number disconnected or quality drops | Business admin (in-app), Springs 360 support |
| Database | Supabase → Reports; advisors | CPU > 80% for 15 min, disk > 80% | Supabase email to the ops address |
| Webhook backlog | `private.webhook_events` with `processed_at is null` older than 15 min | Count > 100 | Checked in the daily ops look |

## Sentry setup (once)

1. Create a project for the Node.js platform. Copy its DSN into the Vercel env `SENTRY_DSN`.
2. Alert rules:
   - "A new issue is created" → #scaler-ops;
   - "Number of events in an issue > 20 in 10 minutes" → on-call.
3. Data scrubbing: on (default). SCALER already sends no headers, cookies, bodies or query strings (`src/lib/monitoring.ts`).

## Daily ops look (5 minutes, every working day)

- Sentry: any unresolved issue from the last day.
- Supabase advisors: no new security or performance warnings.
- `/api/health` history: no stale-job periods overnight.
- Any business with failed imports or failed automation runs (Automation page) asking for help.

## When the health check fails

1. Open `/api/health` and read the reply:
   - **`database: down`** → Supabase status page. Then the project dashboard (paused? out of disk?).
   - **`jobs: stale`** → the scheduler stopped or the job route is failing. Check the Vercel logs for `/api/cron/tasks`. A 401 means `CRON_SECRET` changed in one place only.
2. Errors in the job route are in Sentry with the tag `job: task_jobs`.
3. Jobs are safe to run by hand while you investigate: `curl -H "Authorization: Bearer $CRON_SECRET" https://app.<domain>/api/cron/tasks`.
4. Handle anything that lasts more than 30 minutes as an incident ([incident.md](incident.md)).
