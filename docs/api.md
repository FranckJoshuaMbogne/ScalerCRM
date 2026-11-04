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
| `source` | A lead source key (default `website`): `meta_ads`, `google_ads`, `whatsapp`, `website`, `walk_in`, `referral`, `phone_call`, `instagram`, `other`. |
| `campaign`, `utm_*`, `gclid`, `fbclid`, `campaign_id`, `adset_id`, `ad_id`, `form_id`, `page_url`, `referrer` | Stored as the lead's first and latest touch. |
| `custom_fields` | Only keys defined as lead custom fields are kept. |

Unknown fields are ignored. Body limit: 64 KB.

### Responses

| Status | Body |
|--------|------|
| `201` | New lead: `{ lead_id, lead_number, customer_id, cif_number, lead_created: true, customer_created, replayed: false }` |
| `200` | Repeat enquiry added to the customer's open lead (`lead_created: false`), or a replay of an earlier request with the same `Idempotency-Key` (`replayed: true`). |
| `401` | `missing_api_key` / `invalid_api_key` (wrong or revoked) |
| `409` | `idempotency_key_reused`: same key, different body |
| `413` / `415` / `400` | Body too large / not JSON / malformed |
| `422` | `invalid_lead` with `details`, e.g. `{ "phone": "phone is not a valid number" }` |
