# SCALER public API

## `POST /api/v1/leads`

Sends an enquiry from your website (or any server) into SCALER. The customer is matched by phone, then email; a new customer file is created only if neither is on file.

Create a key in **Settings → API keys** (needs the *Connect and configure integrations* permission). Call the API from your server; never ship the key to browsers.

### Request

```http
POST /api/v1/leads
Authorization: Bearer sk_live_…
Content-Type: application/json
Idempotency-Key: 5d0c7c8e-…            (optional, recommended: one per form submission)

{
  "name": "Ravi Kumar",
  "phone": "98490 12345",
  "email": "ravi@example.com",
  "interest": "Wedding sherwani",
  "message": "Need it by 12 Dec",
  "source": "website",
  "campaign": "diwali-2026",
  "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "diwali",
  "gclid": "…", "fbclid": "…", "page_url": "https://…", "referrer": "https://…",
  "custom_fields": { "garment": "Sherwani" }
}
```

| Field | Notes |
|-------|-------|
| `phone` or `email` | At least one. Phones without a country code use the business's country. |
| `name` | Used only when a new customer file is created. |
| `source` | A lead source key (default `website`). The defaults are `meta_ads`, `google_ads`, `whatsapp`, `website`, `walk_in`, `referral`, `phone_call`, `instagram` and `other`; Settings → Pipeline lists each source's key, including ones you add. |
| `campaign`, `utm_*`, `gclid`, `fbclid`, `campaign_id`, `adset_id`, `ad_id`, `form_id`, `page_url`, `referrer` | Stored as the lead's first and latest touch. |
| `custom_fields` | Only keys defined as lead custom fields are kept. |

Unknown fields are ignored. Body limit: 64 KB.

API leads start in the default stage with no owner. If round-robin is on (Settings → Lead assignment), the next person in the branch's rotation gets the lead and a notification; otherwise it waits in the unassigned queue.

### Responses

| Status | Body |
|--------|------|
| `201` | New lead: `{ lead_id, lead_number, customer_id, cif_number, lead_created: true, customer_created, replayed: false }` |
| `200` | Repeat enquiry added to the customer's open lead (`lead_created: false`), or a replay of an earlier request with the same `Idempotency-Key` (`replayed: true`). |
| `401` | `missing_api_key` / `invalid_api_key` (wrong or revoked) |
| `409` | `idempotency_key_reused`: same key, different body |
| `413` / `415` / `400` | Body too large / not JSON / malformed |
| `422` | `invalid_lead` with `details`, e.g. `{ "phone": "phone is not a valid number" }` |
| `429` | `rate_limited`: more than 120 submissions in a minute with one key. Wait for the `Retry-After` seconds and send again with the same `Idempotency-Key`. |

## Website tracking snippet

Add to every page of the website:

```html
<script src="https://<your-scaler-domain>/scaler-touch.js" async></script>
```

It keeps the visitor's UTM tags, `gclid`, `fbclid`, landing page and referrer for 90 days in a first-party cookie, and nothing is sent anywhere by the script itself. When the website posts a lead, include the touch:

```js
fetch("/your-server/lead", { method: "POST", body: JSON.stringify({ ...formFields, ...window.scalerTouch() }) });
```

Your server forwards those fields to `POST /api/v1/leads` (they are the touch fields listed above). Plain HTML forms also get hidden `scaler_utm_source`, `scaler_gclid`, … inputs added automatically.

## Meta Lead Ads and Google Ads lead forms

These don't use this API. Connect them under Integrations:
- **Meta:** subscribe the Page product's `leadgen` field to `/api/webhooks/meta/leadgen`.
- **Google:** paste the generated webhook URL and key into the lead form.

Leads from both keep their campaign, ad set or ad group, ad and form IDs, and `gclid` for Google.
