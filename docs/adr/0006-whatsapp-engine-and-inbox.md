# ADR 0006 — WhatsApp engine and shared inbox

**Date:** 11 January 2027 · **Status:** accepted

## 1. One provider interface, Meta Cloud API first
`src/modules/integrations/whatsapp/provider.ts` defines what SCALER needs from a provider: send text, read number details, fetch media. `meta-cloud.ts` implements it directly against the Graph API (ADR 0002). A BSP adapter in Sprint 6 implements the same interface. Nothing outside `src/modules/integrations` calls Meta.

## 2. Each business connects its own number; tokens live in Vault
- **Embedded Signup** returns a one-time code. The server exchanges it for the business's token, subscribes SCALER's app to the WABA, and registers the number with a random two-step verification PIN.
- **Manual connect** (WABA ID, phone number ID and a system-user token) covers Meta's test number while Springs 360's app review is pending.
- Either way, the token is checked against Meta before it's stored.
- The token is written straight to **Supabase Vault** by `connect_whatsapp_account()`. Only the vault id is kept on `whatsapp_accounts`, and members can't even select that column.
- Only the service role can read a token, through `whatsapp_send_context()` and `whatsapp_account_token()`. Disconnecting overwrites the secret and keeps all history.
- `phone_number_id` is unique across all businesses, so a number can't be claimed by two tenants.

## 3. Webhook: verify, store, acknowledge, then process
`POST /api/webhooks/whatsapp`:
1. Checks `X-Hub-Signature-256` against `META_APP_SECRET`, over the raw body.
2. Flattens the payload into one item per message and per status.
3. Stores each item in `private.webhook_events`, keyed by `(provider, external_id)`: the message id, or `<message id>:<status>` for a status. A repeated delivery is stored once.
4. Answers 200, and only then processes the items with `after()`.

If storing fails, it answers 500 so Meta retries. Events for numbers nobody has connected are kept as `ignored`.

**No job queue yet.** The plan named Inngest for this hand-off. With `after()` and Postgres-backed retries it isn't needed: the existing job route (`/api/cron/tasks`, every 5 minutes) retries events still pending after a minute, up to five attempts, then marks them `failed`. Integrations shows failed and pending counts per number. A queue becomes worthwhile when the campaign sends in Sprint 6 need throttling. That decision is recorded in `docs/SPRINTS.md`.

## 4. Inbound message → CIF → lead → conversation, in one transaction
The sender's `wa_id` goes through `normalisePhone()`. `ingest_whatsapp_message()` then does the rest in one transaction:
1. **Customer:** matched by phone (Sprint 2 rules); a new file uses the WhatsApp profile name.
2. **Conversation:** one per customer per connected number, as in WhatsApp.
3. **Lead:** the conversation's open lead, or the customer's latest open lead, or a new lead with source `whatsapp`. Round-robin applies to the new lead.
4. **Message:** stored with `wamid` unique, so the same message is never stored twice. The conversation's unread count, last inbound time and waiting-since time are updated.

New conversations go to the lead's owner, if their role can open the inbox. The assignee is notified once per unanswered burst of messages, not for every message.

## 5. Replies respect the 24-hour window, enforced in the database
`queue_whatsapp_reply()` checks, in this order:
- the member can see the conversation and has `inbox.reply`;
- the customer's last message was less than 24 hours ago;
- the number is still connected.

It then stores the message as `queued`, records the response time (seconds since the oldest unanswered customer message), and clears the waiting state. The server sends it through the provider and records the `wamid` or the error. Delivery receipts only move a message's status forward (sent → delivered → read), so receipts arriving out of order are harmless; `failed` always lands.

Outside the window the composer explains why replies are blocked. Template messages arrive in Sprint 6. Internal notes are messages with direction `note`, visible only to the team.

## 6. Visibility and live updates
- `inbox.view_all` sees every conversation; `inbox.view_assigned` sees only the conversations assigned to them.
- Anyone can take a conversation themselves; giving it to someone else needs `inbox.view_all`.
- Media is streamed through `/api/whatsapp/media/[id]`. That route reads the message with the user's own client, so access rules apply before the business's token is used to fetch the file.
- `conversations` and `messages` are in the `supabase_realtime` publication. The inbox subscribes, with access rules filtering what each person receives, and refreshes when either changes.

## Revisit when
- Campaign volume needs a queue and rate control (Sprint 6).
- A BSP is added (Sprint 6).
- Media needs keeping beyond Meta's retention, which would mean copying files into Storage.
