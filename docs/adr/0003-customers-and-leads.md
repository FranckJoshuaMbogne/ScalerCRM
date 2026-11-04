# ADR 0003 — Customer matching, lead history and the public lead API

**Date:** 30 November 2026 · **Status:** accepted

## 1. Matching lives in Postgres; normalisation lives in the app
`normalisePhone()` (libphonenumber, E.164) runs in TypeScript with the business's country as the default. The database only checks the E.164 shape and does the matching in `private.match_or_create_customer()`: **phone → email → create**, never on name. An advisory lock per contact value serialises concurrent submissions, and the unique index on `customer_contacts (business_id, kind, value)` guarantees one phone or email belongs to exactly one customer file per business.

A match fills in a missing phone or email on the matched file only when no other file owns it; it never renames the customer.

## 2. Customers and leads are created only through RPCs
`create_lead()`, `find_or_create_customer()` and the API's `api_submit_lead()` are the only insert paths (direct inserts are revoked). They allocate `CIF-000001` / `L-000001` from `private.business_counters`, a per-business row-locked counter, so numbers never collide across tenants and never skip on rollback.

## 3. History is written by triggers, not by the app
- `lead_status_history` gets a row on insert and on every `status_id` change.
- `lead_activities` gets `created`, `status_changed`, `assigned`, `archived`/`restored`, `customer_merged` and `updated` (with a from/to diff) automatically. Members can only insert manual types (note, call, WhatsApp, email, meeting, visit).
- `customer_events` records creation, every field change (diff), contact changes, notes and merges.
- Consent is a log (`customer_consents`); the current state is the latest row (`customer_consent_state` view).

None of these tables can be updated or deleted from the app. Leads are archived, never deleted.

## 4. Visibility
- Leads: `leads.view_all` within accessible branches (unbranched leads are business-wide), or `leads.view_assigned` for leads you own. Someone with only `view_assigned` owns the leads they create.
- Customers: `customers.view_all` within accessible branches, or `customers.view_assigned` for customers you own or whose leads you own.
- Assigning (`owner_id`) needs `leads.assign`; archiving needs `leads.delete`. A guard trigger enforces both, whatever path the update takes.

## 5. Merge keeps everything
`merge_customers(survivor, duplicate)` moves contacts, addresses, tags, consents, events, files and leads to the survivor, fills only empty fields on the survivor, snapshots the duplicate into `customer_merges`, and leaves the duplicate as a pointer (`merged_into_id`). Old links to the duplicate redirect to the survivor.

## 6. Custom fields: definitions + JSON values
`custom_field_definitions` per business and entity (`customer`, `lead`); values live in `custom_fields jsonb` on the record. Validation is one pure module (`src/modules/custom-fields/engine.ts`) used by every form. The database keeps only keys that are defined and active for leads created through any path, so the API can't stuff arbitrary keys. Keys never change after creation, and hiding a field keeps its values.

## 7. Public API without the service-role key
`POST /api/v1/leads` uses the anon key and calls `security definer` functions that authenticate the per-business API key themselves (`api_keys.key_hash`, SHA-256; the raw key is shown once). This keeps the service-role key out of request handling. Idempotency is stored per business (`api_idempotency_keys`): the same key with the same body replays the first response, with a different body it is rejected (409).

A repeat API enquiry from a customer who already has an open lead is added to that lead (activity `enquiry`, latest source/campaign updated) instead of creating a duplicate lead. Manual entry always creates a new lead, because staff decide.

**Revisit when:** rate limiting lands (Sprint 9), or CORS for browser-side forms is needed (would require publishable, origin-restricted keys).
