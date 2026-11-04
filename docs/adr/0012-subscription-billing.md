# ADR 0012 — Subscription billing

**Date:** 19 April 2027 · **Status:** accepted

## 1. One adapter, two providers
`src/modules/billing` talks to the payment provider through one interface (`BillingProvider`):
- create a plan;
- start a subscription;
- change plan;
- add a one-off charge;
- cancel;
- verify and parse a webhook.

There are two implementations:
- **Razorpay Subscriptions**, the default (UPI autopay, cards, net banking, e-mandates). It is configured by `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`. A `rzp_test_` key is test mode.
- **A fake provider** for development, previews and tests. Its checkout is a page in SCALER, and it never runs in production (`selectProvider`). The billing page shows test controls for renewals, failures, retries running out, the end of grace and cancellation, so the whole lifecycle can be demonstrated without money.

Stripe can be added behind the same interface when SCALER sells outside India.

**Provider plans** are created on first use, one per plan, interval and amount. Each is remembered in `plans.provider_plan_ids`, so a price change creates a new provider plan and existing subscribers keep theirs.

**Money** crosses the provider boundary as integer paise and is stored as `numeric(14,2)`. Conversion uses integer and string arithmetic only (`money.ts`).

## 2. Webhooks drive the state, in the database
Webhooks arrive at `POST /api/webhooks/billing/<provider>`. The route checks the signature on the raw body, then the adapter turns the payload into a provider-neutral event (`kind`, `subscription_id`, `payment`, `period`, `occurred_at`).

`billing_ingest` (service role only) stores the event in `billing_events` and applies it in the same transaction:
- **Idempotent.** The unique key is the provider's event id, so a repeated delivery returns `duplicate`.
- **Append-only.** A trigger refuses edits and deletes; only the outcome is written, once.
- **Failures are kept.** An event that can't be applied (for example, an unknown subscription) is stored with its error and shown on Platform → Billing. The provider isn't asked to retry it forever.
- **Out of order.** An event older than the last one applied never moves the status back. A payment is always invoiced, whatever order it arrives in, because the money moved.

| Status | Means | Business |
|--------|-------|----------|
| trialing | Not paying yet (on a trial, or never subscribed) | Active |
| active | Paid up | Active |
| past_due | A renewal failed; the provider is retrying | Active; banner and email |
| grace | Retries are over, or the trial ended; 7 days from the first failure | Active; banner and reminders |
| read_only | Unpaid after grace | Suspended by billing: view, export and pay only |
| cancelled | Ended by the business at the period end | Suspended by billing |

Time-based moves are made by `billing_tick()`, which the job route runs every 5 minutes:
- a trial reminder 3 days before the end;
- the trial's end;
- a reminder 2 days before grace ends;
- grace running out.

Every status change is appended to `subscription_status_history`.

**Who suspended the business matters.** `businesses.suspended_by` is `platform` or `billing`:
- A payment lifts only a billing suspension. A suspension made in the platform console (for example, a fraud check) stays until the console lifts it.
- `platform_set_status` now records itself as the suspender.

**Read-only can still pay.** Sprint 10 kept view and export permissions for suspended businesses. `billing.manage` is added to that list, so a read-only business can update its billing details and check out again. `billing.manage` is a new permission given to business admins and accounts.

**Nothing is deleted for non-payment.** Read-only businesses keep everything. Platform → Billing lists businesses that have been read-only for 90 days or more, for a person to decide what happens next.

**Businesses billed by hand** have no subscription row and no trial, and billing leaves them alone. MY PERFECT FIT is one of these until it chooses to pay online.

## 3. Plan changes
`billing_quote` says what a change would do:
- **checkout:** starting to pay. This also applies from grace (the provider has stopped retrying), from read-only or after cancelling.
- **now:** an upgrade, meaning the same interval at a higher price. Limits rise at once. The prorated difference for the rest of the period is added to the next charge as a provider add-on.
- **renewal:** a downgrade or an interval change. It applies when the next `charged` event arrives, if the business still fits.

Both a downgrade and starting a checkout are refused while the business uses more than the target plan allows. The page lists exactly what is over the limit. If a business no longer fits when the renewal comes, it renews on its current plan and is emailed why.

Negotiated or grandfathered overrides (Sprint 10) stay with the business across plan changes. Only the platform console changes them.

## 4. GST invoices
One invoice is issued per captured payment (unique on provider + payment id), inside `billing_ingest`. Invoices are immutable; corrections will be credit notes.

- **Amounts.** The invoice total is the amount actually paid. The taxable value and tax are derived from it at the seller's GST rate (18%), so invoices always reconcile with settlements to the paisa.
- **Place of supply.** It comes from the buyer's state, which a GSTIN determines. Same state as the seller: CGST + SGST. Otherwise: IGST. Outside India: zero-rated export.
- **Numbering.** Numbers are sequential with no gaps, per financial year (April–March, IST): `SCL/27-28/00001`, at most 16 characters as GST rules require. The prefix is 2–4 letters, set by Springs 360.
- **Test invoices.** Test-mode payments, and any payment before Springs 360's GSTIN is entered, get test invoices on a separate `TEST/…` series. The live series never has gaps from tests.
- **Snapshots.** The seller and buyer details are copied onto the invoice, so later edits don't change issued invoices.
- **PDF.** The invoice page is laid out for the browser's "Save as PDF" (as Sprint 8 reports are). The invoice email links to it.

**Reconciliation.**
- `private.billing_reconciliation()` compares every payment event with its invoice.
- On Platform → Billing, an uploaded Razorpay settlement report is matched by payment id and amount.

## 5. Dunning
Emails go through the Sprint 3 outbox, at most once per notice: `private.billing_notices` is keyed by business, kind and reference.

**Recipients.** Emails go to the billing contact, or to the business admins if no billing details have been entered.

**Notices:**
- trial ending;
- trial ended;
- payment failed;
- grace ending;
- read-only;
- cancelled;
- downgrade postponed;
- invoice.

**In-app.** The banner shows when a payment is due, when the business is read-only because of billing (with a Pay now link for people with billing access), and when a trial is ending.

## Still needed before live payments
- **Razorpay account:** live keys, Subscriptions enabled, and the webhook secret.
- **Plan prices**, set in Platform → Plans.
- **Springs 360's legal name, GSTIN, address and invoice prefix**, set in Platform → Billing.
- **SAC code.** Confirm it with Springs 360's accountant. The default is 997331, licensing services for the right to use software.
- **UPI autopay and plan changes.** Razorpay applies plan changes to card subscriptions. For UPI-mandate subscriptions, a plan change may need a new mandate; this is checked in Razorpay test mode before go-live.
