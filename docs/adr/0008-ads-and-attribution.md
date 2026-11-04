# ADR 0008 — Meta and Google lead intake, ad spend and attribution

**Date:** 8 February 2027 · **Status:** accepted

## 1. Paid leads take the same path as every other lead
Meta Lead Ads and Google Ads lead-form submissions follow the WhatsApp webhook pattern (ADR 0006). Each lead is stored in `private.webhook_events`, keyed by the leadgen ID or Google lead ID so repeats are dropped. The webhook is answered straight away; the lead is processed after the response and retried by the job route.

`ingest_external_lead()` calls `private.create_lead_internal()` with `reuse_open_lead`, so the usual rules apply:
- phone, then email matching;
- a returning customer's enquiry goes onto their open lead as a repeat enquiry;
- round-robin assignment and full history.

Phones go through `normalisePhone()` with the business's country.

- **Meta:** the Page `leadgen` webhook carries only IDs. The processor fetches the lead with that page's token (stored in Vault, like WhatsApp tokens) and keeps the campaign, ad set, ad and form IDs. An Instagram placement becomes source `instagram`; Facebook becomes `meta_ads`.
- **Google:** each lead form gets its own webhook URL token and key. Only the SHA-256 hashes are stored, and both are shown once. The key Google sends must match. Test submissions are acknowledged but don't create a lead. Leads keep campaign, ad group, creative and `gclid`.

## 2. Form mapping is learned, then editable
The first lead from a form records the form and its field names in `lead_forms`.
- **Default mapping:** standard names (`full_name`, `phone_number`, `email`, first and last name) map automatically; everything else goes into the lead's notes, so nothing is lost.
- **Admin mapping:** an admin can map any field to a lead custom field, or to ignore. They can also fix the lead source and branch for that form.
- The mapping applies to later leads. It is audited.

## 3. Ad spend is synced, not entered
`ad_accounts` hold a Meta ads token or a Google Ads OAuth refresh token, in Vault. Every 6 hours the job route pulls the last 30 days of spend per campaign per day and upserts them into `ad_campaigns` and `ad_spend_daily`. Re-syncing a day replaces it, since platforms restate recent spend.
- **Meta:** the Insights API at campaign level, one row per day.
- **Google:** GAQL over the REST API. This needs the server's `GOOGLE_ADS_DEVELOPER_TOKEN` and OAuth client. Cost in micros is converted exactly with BigInt.

## 4. Touchpoints and attribution
`lead_touchpoints` is append-only. It records one `first` touchpoint per lead and one `repeat` touchpoint per repeat enquiry, written by triggers and backfilled for existing leads. Merges carry touchpoints to the surviving customer file.

`attribution_report(business, from, to)` credits each non-cancelled order in the period to the customer's touchpoints within the business's lookback window (default 90 days):
- **first touch:** all revenue to the earliest touchpoint;
- **last touch:** all revenue to the latest;
- **linear:** split evenly across them;
- **assisted:** orders where a touchpoint was in the middle.

Rows are grouped by source and campaign ID (or campaign name), with leads, spend, cost per lead and ROAS. The business picks the model that counts as revenue (`attribution_settings`, audited). The other models stay visible for comparison.

Orders show "How they found us" from these touchpoints.

## 5. Website tracking without third parties
`/scaler-touch.js` stores the landing UTM tags, `gclid`, `fbclid`, page and referrer in a first-party cookie for 90 days. It fills hidden `scaler_*` fields in forms and exposes `window.scalerTouch()` for the lead API. It sends nothing anywhere itself.

## 6. Integration health
The Integrations page shows, per business:
- webhook events in the last 24 hours, pending and failed, with the latest failures and a "Retry failed events" button;
- for each page and ad account: status, last lead or last sync, and token expiry from Meta's `debug_token` (highlighted inside 7 days).

## Not built: Instagram and Messenger enquiries
Direct-message intake needs the `instagram_manage_messages` and `pages_messaging` permissions, which require Meta app review of Springs 360's app (ADR 0002). Lead Ads on Instagram already work (§1). DMs plug into the inbox once the review is granted. They need a channel column on conversations and a Messenger adapter behind `MessagingProvider`.
