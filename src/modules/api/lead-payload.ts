import { createHash } from "node:crypto";
import type { CountryCode } from "libphonenumber-js";
import { z } from "zod";
import { normalisePhone } from "@/modules/crm/phone";

/**
 * Body accepted by `POST /api/v1/leads`. Website forms send whatever they
 * collect; we keep the contact, a short description and the attribution
 * fields, and let the database do matching and numbering.
 */
const text = (max: number) => z.string().trim().max(max).optional();

const TOUCH_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "campaign_id",
  "adset_id",
  "ad_id",
  "form_id",
  "page_url",
  "referrer",
] as const;

export const leadPayloadSchema = z
  .object({
    phone: text(40),
    email: z.email("email is not a valid address").trim().toLowerCase().max(200).optional(),
    name: text(160),
    source: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]+$/, "source must be a lead source key, e.g. website")
      .max(40)
      .optional(),
    campaign: text(200),
    interest: text(160),
    message: text(4000),
    custom_fields: z.record(z.string().max(40), z.unknown()).optional(),
    ...Object.fromEntries(TOUCH_KEYS.map((k) => [k, text(2000)])),
  })
  .strip();

export type LeadPayload = z.infer<typeof leadPayloadSchema>;

export type ParsedLead =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

/** Validates a request body and turns it into `create_lead_internal` input. */
export function parseLeadPayload(body: unknown, defaultCountry: CountryCode): ParsedLead {
  const parsed = leadPayloadSchema.safeParse(body);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? "body")] ??= issue.message;
    return { ok: false, errors };
  }
  const d = parsed.data as LeadPayload & Record<string, string | undefined>;

  let phone: string | null = null;
  if (d.phone) {
    phone = normalisePhone(d.phone, defaultCountry);
    if (!phone) return { ok: false, errors: { phone: "phone is not a valid number" } };
  }
  if (!phone && !d.email) return { ok: false, errors: { phone: "send a phone number or an email" } };

  const touch: Record<string, string> = {};
  for (const k of TOUCH_KEYS) if (d[k]) touch[k] = d[k]!;

  const input: Record<string, unknown> = {
    phone,
    email: d.email ?? null,
    full_name: d.name ?? null,
    title: d.interest ?? null,
    description: d.message ?? null,
    campaign: d.campaign ?? touch.utm_campaign ?? null,
    touch,
  };
  if (d.source) input.source = d.source;
  if (d.custom_fields) input.custom_fields = d.custom_fields;
  return { ok: true, input };
}

/** Stable JSON (sorted keys) so a retried request hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

/** Reads the key from `Authorization: Bearer …` or `X-API-Key`. */
export function readApiKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const key = bearer ?? headers.get("x-api-key")?.trim();
  return key && key.length <= 200 ? key : null;
}
