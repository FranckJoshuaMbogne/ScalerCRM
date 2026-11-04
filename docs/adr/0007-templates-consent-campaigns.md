# ADR 0007 — Templates, consent and campaigns

**Date:** 25 January 2027 · **Status:** accepted

## 1. Only approved templates, only to people who opted in
The database enforces this, not the screens:
- `launch_campaign()` refuses a template that isn't `approved`, a number that isn't connected, and a template from a different WhatsApp Business Account (WABA) than the sending number. It also refuses a campaign whose template variables aren't all filled.
- Recipients are built from `private.audience()`. A customer is included only if they have a phone, their **latest** WhatsApp marketing consent is `opted_in`, and the number isn't on the suppression list. One message goes to each phone number.
- At send time `claim_campaign_batch()` checks consent and the suppression list again. Someone who opts out after launch is marked skipped, never sent to.

## 2. Consent is a log; opt-outs are automatic
`customer_consents` (Sprint 2) stays append-only. New ways in:
- **Opt-in:** a tick box on the lead and walk-in forms (source `form`), or the customer replying START (source `whatsapp_keyword`).
- **Opt-out:** an inbound STOP, UNSUBSCRIBE or "Stop promotions" message (the quick-reply button the template builder suggests) records `opted_out` and adds the number to `suppressions`. This runs in a trigger on inbound messages, so the WhatsApp webhook path and any future path behave the same.

The suppression list also takes numbers WhatsApp reports as unreachable (error 131026) or as having blocked marketing (131050), plus numbers staff add by hand. Staff can remove only manual and unreachable entries. A customer opt-out is lifted only by the customer replying START.

## 3. Throttled queue in Postgres, sent by the job route
- Campaign recipients are the queue. `claim_campaign_batch()` gives each campaign at most `rate_per_minute × 5` sends per 5-minute window, counting what it already sent. It claims with `SKIP LOCKED`, so overlapping workers never double-send.
- Temporary failures (rate limits, network, Meta's throttling codes) retry with exponential back-off, up to three attempts. Other failures are final.
- The job route (`/api/cron/tasks`, every 5 minutes, `maxDuration` 300) runs the worker with 5 sends in parallel. Launching or resuming a campaign also runs one batch straight away with `after()`.
- `campaign_tick()` starts scheduled campaigns, frees claims left by a crashed sender, and closes campaigns with nothing left to send.
- **Inngest is still not needed.** Throttling, retries and scheduling fit in the database plus a 5-minute tick. Revisit if campaigns need finer timing than 5-minute windows, or volumes beyond a few thousand recipients per tick.

## 4. Campaign messages live in the inbox
A successful send creates (or reuses) the customer's conversation and stores the rendered message there as an outbound `template` message. Read receipts then flow through the Sprint 5 path, and a trigger copies delivered/read/failed onto the recipient. A customer reply within 7 days is credited to the latest campaign sent to them.

The report counts sent, delivered, read, failed, skipped and replied, plus outcomes from the recipients themselves: leads created within 7 days and orders (with revenue) within 30 days of their send.

## 5. Templates
- Templates are stored per **WABA**, as Meta stores them. The builder checks Meta's rules before submitting: numbered variables with no gaps, not at the start or end, an example for each; text length limits; up to 3 buttons.
- Media headers upload a sample file through Meta's Resumable Upload API to get the review handle.
- Approval arrives through the `message_template_status_update` webhook, or the Sync button.
- Members can't mark a template approved: `status` and the provider id are written only by the server after the provider answers.

## 6. Second provider: 360dialog
`dialog360.ts` implements the same `MessagingProvider` interface. 360dialog's v2 API uses the Cloud API message format, so sends, webhooks and template payloads are shared; only the host and the `D360-API-KEY` header differ. `whatsapp_accounts.provider` decides which adapter is used.

360dialog doesn't sign its webhooks the way Meta does. Each 360dialog account gets an unguessable URL token (`/api/webhooks/whatsapp/d360/<token>`), shown once; only its SHA-256 hash is stored. Media-header templates for 360dialog are created in the 360dialog hub and picked up with Sync.

## Revisit when
- Per-recipient send-time optimisation or A/B tests are needed.
- SMS or email campaigns are added (consent channels already exist).
- Campaign attribution needs the click-level data that arrives in Sprint 7.
