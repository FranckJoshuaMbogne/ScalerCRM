# ADR 0010 — Hardening, imports and go-live

**Date:** 8 March 2027 · **Status:** accepted

## 1. CSV imports run in the database, one savepoint per row
`/settings/import` (new permission `data.import`, business admins only) takes a CSV of customers, leads or orders.

**Parsing in the app.** The file is parsed and checked in the app by `src/modules/imports`:
- Headers are recognised by common spellings.
- Phones go through `normalisePhone()`.
- Dates can be `DD/MM/YYYY` or ISO.
- Rupee amounts may use Indian digit grouping.
- Branch, source, stage, lost reason and owner names are matched to their ids.

Rows with problems are listed and never sent.

**Writing in the database.** Clean rows go to `import_rows()` in batches of 250. Each row runs in its own savepoint:
- A bad row is recorded as failed with the database's reason, and the batch carries on.
- `import_job_rows` remembers every processed row, so a retried batch never imports twice.
- Leads and orders carry an `external_ref`. Re-running a migration file skips references already in SCALER.

**Imported history keeps its dates.** Creation, closing, delivery and payment dates are kept, so analytics cohorts stay correct. An imported closed lead is inserted directly in its final stage. While `import_rows()` runs it sets a transaction-local flag, `scaler.importing`. Trigger `WHEN` clauses read the flag to skip what makes no sense for history:
- round-robin;
- "assigned to you" notifications;
- automations;
- the "new leads start open" rule, which `import_lead()` replaces with its own checks.

No other code path sets the flag. Customers are matched by phone, then email, exactly as for live leads.

## 2. Rate limits are fixed windows in Postgres
`private.rate_limits` counts hits per bucket and window. No Redis: the volumes are small, and Postgres is already a dependency for every request.

| Limit | Bucket | Value |
|-------|--------|-------|
| Lead API | per API key | 120 per minute; then `429` with `Retry-After` |
| Exports | per person | 20 per hour |
| Sign-in, sign-up, password reset | Supabase Auth | Supabase's own limits (runbook: deploy, step 3) |

Exports of 1,000 rows or more also notify everyone who can read the audit log.

## 3. Privileges: deny by default, checked by a test
The new `99_security_audit.sql` runs after every migration and fails CI if any of these is true:
- a public table lacks RLS or policies;
- a tenant table lacks `business_id`;
- a view isn't `security_invoker`;
- a security-definer function doesn't pin `search_path`;
- the anonymous role can call anything beyond an explicit allow-list (the lead API, invitations, health);
- the anonymous role has any table privilege;
- signed-in users can `TRUNCATE`;
- job-runner functions are callable by signed-in users;
- a column looks like a plain-text secret.

Writing the test found one real gap. Supabase's default grants had left the anonymous role full rights on the foundation tables, and every role `TRUNCATE`, which RLS doesn't cover. Policies still blocked access, but the grants are now revoked, and default privileges are changed so future tables start closed.

## 4. Push without a push library
Notifications already exist in the database, so the job route wakes devices instead of composing messages:
- `claim_push_batch()` marks new notifications and returns one subscription per device.
- The app sends an **empty** Web Push, signed with VAPID using Node's crypto (`src/modules/push/vapid.ts`).
- The service worker then fetches `/api/notifications/latest` with the user's own session.

Nothing personal passes through Google's or Apple's push services, and no payload encryption (or `web-push` dependency) is needed. Subscriptions belong to a person, not a business. A `410` from the push service deletes the subscription, and five failures in a row do too.

## 5. Offline means "today's tasks", not an offline CRM
The service worker (`public/sw.js`) does three things:
- caches hashed static files;
- keeps the last copy of `/api/tasks/today`;
- shows `/offline` when a page can't load. That page lists today's tasks with call links, which is what a salesperson needs in a shop with poor signal.

Everything else needs a connection. Writes are never queued offline: conflicting edits to leads and payments are worse than a clear "you're offline".

Signing out sends `Clear-Site-Data: "cache", "storage"`. That removes the worker, its cached tasks and the push subscription from shared devices.

## 6. Monitoring without an SDK
- **Server errors.** `onRequestError` in `src/instrumentation.ts` posts server errors to Sentry's envelope API when `SENTRY_DSN` is set. Reports carry the route and the path without its query string; never headers, cookies or bodies.
- **Job heartbeats.** Background jobs record a heartbeat.
- **`/api/health`.** Returns 503 when the database is down or jobs haven't succeeded for 15 minutes. That one URL is what the uptime monitor watches.

## 7. Load test, and RLS evaluated once per query
`scripts/load-test.sh` builds a disposable database and seeds:
- 100,000 customers;
- 150,000 leads;
- 60,000 orders with payments;
- about 51,000 tasks;
- a campaign to 60,000 opted-in customers.

It then times the busiest queries as real users, with RLS on.

**What the first run showed:**

| Query | Time |
|-------|-----:|
| Lead list page (including its exact count) | 36 s |
| Admin's lead count | 39 s |
| Salesperson's lead count | 34 s |

The cause was the read policies: they called permission helpers for every row.

**The fix:** policies on the busy tables compare rows with arrays of the caller's permitted businesses and branches, computed once per statement (`(select private.permitted_business_ids('…'))::uuid[]`). Each rule is the same as before, and every isolation suite passes unchanged.

**New policies follow this pattern.** Per-row helpers are fine on small configuration tables.

Results and indexes are in [docs/load-test.md](../load-test.md).

## 8. Go-live is a runbook, not an automated step
Production changes are made by a person:
- `scripts/deploy-production.sh` is a dry run unless given `--confirm <tag>`, and asks for the tag again before migrating.
- `scripts/backup.sh` and `scripts/restore-drill.sh` refuse obvious mistakes, such as restoring over a Supabase project.

The runbooks in `docs/runbooks/` and the [v1.0 release checklist](../release-checklist.md) are the record of what was done.

## Not built
- **A column-mapping screen for imports.** Header aliases cover common exports. Files with unusual headers are renamed to the template's headings.
- **A nonce-based script CSP.** The CSP currently covers framing, plugins, `<base>` and form targets.
- **Background sync of offline edits.**
