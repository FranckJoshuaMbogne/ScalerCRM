# SCALER public API

The full reference is generated from the code: `/developers` (readable), `/api/v1/openapi.json` (OpenAPI 3.1) and `/api/v1/postman.json` (Postman). Decisions are in [ADR 0014](adr/0014-public-api-and-webhooks.md).

## Keys and scopes

Create keys in **Settings → API keys** (needs the *Connect and configure integrations* permission) and tick what each key may do. Call the API from your server only.

| Scope | Allows |
|-------|--------|
| `leads:write` | `POST /leads`, `PATCH /leads/{id}`. Website forms need only this; keys from before Sprint 13 have exactly this. |
| `leads:read` | `GET /leads`, `GET /leads/{id}` |
| `customers:read` | `GET /customers`, `GET /customers/{id}` |
| `orders:read` | `GET /orders`, `GET /orders/{id}`, `GET /payments`, `GET /payments/{id}` |
| `orders:write` | `POST /orders`, `PATCH /orders/{id}` |
| `tasks:write` | `POST /tasks` |
| `webhooks:manage` | `GET/POST /webhooks`, `PATCH/DELETE /webhooks/{id}` |

A key only ever sees its own business. Records of other businesses answer `404`.

## Conventions

- **Versions.** `/api/v1` is stable. Breaking changes only come in `/v2`, announced 6 months ahead.
- **Lists** answer `{ "object": "list", "data": [...], "has_more": true, "next_cursor": "…" }`, oldest change first.
  - `?limit=` (1–100, default 50).
  - `?cursor=<next_cursor>` for the next page.
  - `?updated_since=<ISO time>` to sync only what changed.
  - Filters: customers `phone`, `email`; leads `customer_id`, `status`; orders `customer_id`, `stage`; payments `order_id`, `customer_id`.
- **Writes** take `Idempotency-Key`.
  - A retry with the same key answers like the first time, with the header `Idempotent-Replayed: true`, and never writes twice.
  - The same key with a different request gets `409 idempotency_key_reused`.
- **Money** is a decimal string (`"1250.00"`) in and out. **Times** are ISO 8601 with an offset.
- **Rate limits** are per key, by plan: Starter 120, Growth 300, Scale 600 requests a minute. Every answer has `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds); over the limit you get `429 rate_limited` with `Retry-After`. The plan's daily call allowance also applies.
- **Errors** are `{ "error": "<code>", "message": "…", "details": { "<field>": "…" } }`:

| Status | `error` |
|--------|---------|
| 401 | `missing_api_key`, `invalid_api_key` (wrong or revoked) |
| 403 | `insufficient_scope` (the key lacks the scope); `business_read_only` (a suspended business can be read, not written) |
| 404 | `not_found` |
| 409 | `idempotency_key_reused` |
| 413 / 415 / 400 | body too large (64 KB) / not JSON / malformed |
| 422 | `invalid_request` (with `details`), or `invalid_lead` for `POST /leads` |
| 429 | `rate_limited` |

## Endpoints

| Method | Path | Scope | |
|--------|------|-------|---|
| GET | `/customers`, `/customers/{id}` | `customers:read` | Customer files; `merged_into_id` points at the survivor of a merge |
| GET | `/leads`, `/leads/{id}` | `leads:read` | Leads with stage, value, sources and touches |
| POST | `/leads` | `leads:write` | An enquiry (below) |
| PATCH | `/leads/{id}` | `leads:write` | `status` (stage key), `title`, `description`, `expected_value`, `owner_id`, `lost_reason_id`, `lost_note`, `custom_fields`. The business's pipeline rules apply. |
| GET | `/orders`, `/orders/{id}` | `orders:read` | Orders with lines, totals, `paid` and `balance` |
| POST | `/orders` | `orders:write` | `customer_id`, optional `lead_id`, `due_date`, `notes`, `custom_fields`, and `items` (`description`, `quantity`, `unit_price`, `discount`, `tax_rate`, `catalog_item_id`). Starts in the first open stage. |
| PATCH | `/orders/{id}` | `orders:write` | `stage` (stage key), `due_date`, `notes`, `custom_fields` |
| GET | `/payments`, `/payments/{id}` | `orders:read` | Payments and refunds (never edited) |
| POST | `/tasks` | `tasks:write` | `lead_id` or `customer_id`, `title`, `due_at`, optional `type`, `notes`, `assignee_id` (default: the owner) |
| GET, POST | `/webhooks` | `webhooks:manage` | List, or add an endpoint (`url`, `events`, `description`); the answer carries the signing secret once |
| PATCH, DELETE | `/webhooks/{id}` | `webhooks:manage` | Change `url`, `events`, `description`, `is_active`; or delete |

```bash
curl "$SCALER/api/v1/orders?stage=ready&limit=20" -H "Authorization: Bearer $SCALER_KEY"

curl -X PATCH "$SCALER/api/v1/orders/<id>" \
  -H "Authorization: Bearer $SCALER_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" -d '{"stage": "delivered"}'
```

## `POST /api/v1/leads`

Sends an enquiry from your website (or any server) into SCALER. The customer is matched by phone, then email; a new customer file is created only if neither is on file.

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
| `403` | `insufficient_scope` (the key has no `leads:write`) / `business_read_only` |
| `409` | `idempotency_key_reused`: same key, different body |
| `413` / `415` / `400` | Body too large / not JSON / malformed |
| `422` | `invalid_lead` with `details`, e.g. `{ "phone": "phone is not a valid number" }` |
| `429` | `rate_limited`: over the plan's requests a minute for this key. Wait for the `Retry-After` seconds and send again with the same `Idempotency-Key`. |

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

## Outbound webhooks

Add endpoints in **Settings → Webhooks** (or through `/api/v1/webhooks`) and choose events:

| Event | `data` |
|-------|--------|
| `lead.created` | the lead |
| `lead.stage_changed` | `{ lead, from_status, to_status }` |
| `order.created` | the order, with lines and totals |
| `order.stage_changed` | `{ order, from_stage, to_stage }` |
| `payment.recorded` | the payment or refund |
| `customer.merged` | `{ merged_customer_id, customer }` (the survivor) |

Each event is a JSON POST:

```http
POST /your-endpoint
Content-Type: application/json
Scaler-Event: order.stage_changed
Scaler-Delivery: whd_1042
Scaler-Signature: t=1779000000,v1=5f0c…

{ "id": "evt_981", "object": "event", "type": "order.stage_changed", "api_version": "v1",
  "created_at": "2027-05-20T11:02:07.51+05:30", "business_id": "…",
  "data": { "order": { … }, "from_stage": "in_production", "to_stage": "ready" } }
```

- Answer any 2xx within 10 seconds. Anything else is retried after 1, 5 and 30 minutes, then 2, 5 and 10 hours, until 24 hours have passed.
- Redirects are not followed, and only public https addresses are allowed.
- An event can arrive more than once (a retry or a replay): ignore repeats of the same `id`. Order across events is not guaranteed.
- After 20 failed deliveries in a row the endpoint is switched off and everyone who manages integrations gets an email. Turn it back on, then replay what was missed from the delivery log (kept 30 days).
- **Send a test event** on the endpoint's page sends a `ping`.

### Checking the signature

`v1` is the hex HMAC-SHA256 of `<t>.<raw body>` keyed with the endpoint's signing secret (`whsec_…`). Use the body exactly as received, and refuse timestamps more than 5 minutes old. These samples are the ones on `/developers`; the Node one is run by the test suite.

```js
const crypto = require("node:crypto");

function verifyScalerSignature(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(String(header || "").split(",").map((p) => p.trim().split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(t + "." + rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

```python
import hashlib, hmac, time

def verify_scaler_signature(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    parts = dict(p.strip().split("=", 1) for p in (header or "").split(",") if "=" in p)
    try:
        t = int(parts["t"])
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > tolerance or "v1" not in parts:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])
```
