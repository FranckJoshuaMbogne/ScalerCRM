# ADR 0014 — Public API and outbound webhooks

**Date:** 17 May 2027 · **Status:** accepted

## 1. Keys carry scopes
An API key belongs to one business and carries a set of scopes:

| Scope | Allows |
|-------|--------|
| `leads:write` | `POST /leads`, `PATCH /leads/{id}` |
| `leads:read` | `GET /leads`, `GET /leads/{id}` |
| `customers:read` | `GET /customers`, `GET /customers/{id}` |
| `orders:read` | orders and payments (payments have no scope of their own) |
| `orders:write` | `POST /orders`, `PATCH /orders/{id}` |
| `tasks:write` | `POST /tasks` |
| `webhooks:manage` | `/webhooks` |

**Keys stay as they were.** They are hashed and shown once, can be revoked, and record when they were last used (written at most once a minute, so reads don't turn into writes).

**Old keys keep working.** Sprint 2 keys get `leads:write`, which is all website forms need, and that is also the default when a key is created without scopes.

**Who makes keys.** Keys and webhooks need `integrations.manage`, as API keys always have. No new permission was added.

## 2. A key acts like a user who has exactly its scopes
The API calls `api_*` database functions with the anonymous role. Each function:
- resolves the key to its business with `private.api_key_auth(key, scope, write)`. This refuses an unknown or revoked key (401), a missing scope (403 `insufficient_scope`) and a write to a suspended business (403 `business_read_only`; reads still work, as in the app);
- filters every query by that business. A key cannot name another business, and ids from other businesses read as not found;
- writes through the same tables, triggers and guards as the app.
  - Lead updates pass the pipeline rules (stages that need an owner, lost reasons, round-robin), and the status history and timeline record them.
  - Orders get their number, first open stage, lines and totals from the same helpers as `create_order`.
  - Tasks go through `prepare_task`, so the assignee must be an active member.

**This is not row level security.** The API has no signed-in user, so RLS can't decide what it sees. The tenant boundary is the key-to-business lookup inside each function. `supabase/tests/985_public_api.sql` checks that a key can't read or write outside its business or scopes, for every resource and for webhooks.

## 3. REST conventions
`/api/v1` is stable. Breaking changes only come in `/v2`, with six months' notice (the default in "Decisions to confirm early").

**Lists.** Lists are ordered by `(updated_at, id)`, oldest first. Payments never change, so they use `created_at`.
- `next_cursor` is that pair encoded as base64url, with microseconds kept.
- `updated_since` filters on the same column, so a client can sync either by cursor or by the last `updated_at` it saw.
- New indexes on `(business_id, updated_at, id)` keep every page at about 10 ms with 150k leads (load test).

**Idempotency.** Every write takes `Idempotency-Key`.
- The first response is stored (`api_idempotency_keys`) under a hash of method, path and body.
- A retry with the same key returns the first response with `Idempotent-Replayed: true`.
- The same key with a different request gets 409.
- `POST /leads` keeps the Sprint 2 hash (body only), so retries that started before the upgrade still match.

**Money and time.** Money is a decimal string, both in and out, never a float. Times are ISO 8601 with an offset.

**Rate limits.** Limits are per plan and per key: Starter 120, Growth 300, Scale 600 requests a minute, and Enterprise 1,200 unless overridden. The plan's daily allowance (Sprint 10) still applies. `api_rate` returns what `X-RateLimit-Limit`, `-Remaining` and `-Reset` need. A refused request gets 429 with `Retry-After`.

## 4. The OpenAPI document is generated from the zod schemas
`src/modules/api/schemas.ts` describes every request, response and webhook payload.

**What is built from them:**
- `openapi.ts` turns them into OpenAPI 3.1 (`z.toJSONSchema`) and adds the operation table. Webhook payloads go under the 3.1 `webhooks` key.
- The operation table also builds the Postman collection (`/api/v1/postman.json`) and the public reference page (`/developers`).
- The request handlers validate bodies with the same schemas.

**Contract tests** (`contract.test.ts`) check that:
- the route files implement exactly the documented operations;
- every `$ref` resolves;
- every operation documents its scope, auth, rate-limit headers and errors;
- the request examples are valid.

`scripts/db-test.sh` also runs `supabase/tests/contract_samples.sql` and checks real `api_*` output, and the stored payload of every webhook event, against the schemas. Response schemas are strict, so a field added in SQL but not documented fails the test. The CI database job now runs `npm ci` for this.

## 5. Webhooks: an outbox written by triggers, sent by the job route
**Endpoints.** A business has up to 10 endpoints (`webhook_endpoints`, audited). Each has an https URL, the events it wants and a signing secret.
- The secret is in Vault, like provider tokens; only its prefix is readable. It is shown once when the endpoint is made or the secret is rotated.
- Private, loopback and link-local addresses are refused when an endpoint is saved, and again after DNS resolution on every send.
- Redirects are not followed.

**Events.** Triggers queue the events: `lead.created`, `lead.stage_changed`, `order.created`, `order.stage_changed`, `payment.recorded` and `customer.merged`.
- `private.emit_webhook` writes one `webhook_events` row and one `webhook_deliveries` row per listening endpoint, in the same transaction as the change. An event is never lost or sent for a change that rolled back.
- It costs one indexed lookup when nobody listens.
- `order.created` is a deferred constraint trigger, so the payload has the lines and totals written after the order row.
- Imports (`scaler.importing`) don't emit events.

**Payloads.** A payload is the same JSON the API returns for that record, inside an envelope: `id` (`evt_…`), `type`, `api_version`, `created_at`, `business_id` and `data`. Events are append-only.

**Sending.** The job route claims due deliveries (`claim_webhook_deliveries`), each leased for 2 minutes, and POSTs them 10 at a time with a 10-second timeout.
- Signature: `Scaler-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.
- Other headers: `Scaler-Event` and `Scaler-Delivery`.

**Retries.**
- **Failures.** Any non-2xx answer or error is retried after 1, 5 and 30 minutes, then 2, 5 and 10 hours, until the delivery is 24 hours old. Then it is marked failed.
- **Switch-off.** After 20 failed attempts in a row, the endpoint is switched off. Its queued deliveries are cancelled and everyone with `integrations.manage` gets an email (`webhook_disabled`). Turning it back on clears the count.
- **Replay.** The delivery log (Settings → Webhooks) keeps 30 days of events. Replay makes a new delivery of the same event, with its own 24 hours.

**Verification samples.** The Node and Python samples are published on `/developers` and in `docs/api.md`. `sign.test.ts` runs the published Node sample against real signatures.

## Consequences
- **Duplicates.** A receiver can get an event twice (a retry after a timeout, or a replay) and must deduplicate on `id`. Ordering across events is not guaranteed.
- **Slow delivery.** Events go out on the job route's 5-minute tick. Faster delivery would need a queue worker (the Inngest question in ADR 0006).
- **A DNS race.** A host could change its DNS answer between the check and the request. The window is small, and the response body is never read or stored.
- **No `GET /tasks`.** The tasks scope is write-only, as planned. Reading tasks waits until a partner needs it.
