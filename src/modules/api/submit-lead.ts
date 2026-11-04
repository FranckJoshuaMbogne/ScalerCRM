import "server-only";
import type { CountryCode } from "libphonenumber-js";
import { createAnonClient } from "@/lib/supabase/anon";
import { parseLeadPayload, readApiKey, requestHash } from "./lead-payload";

const MAX_BODY_BYTES = 64 * 1024;

type Result = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

const fail = (status: number, error: string, details?: Record<string, string>): Result => ({
  status,
  body: details ? { error, details } : { error },
});

/** Handles one API lead submission. Every check that touches data runs in Postgres. */
export async function submitLead(request: Request): Promise<Result> {
  const apiKey = readApiKey(request.headers);
  if (!apiKey) return fail(401, "missing_api_key");

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 200) return fail(400, "idempotency_key_too_long");

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return fail(415, "content_type_must_be_json");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return fail(413, "body_too_large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "invalid_json");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "body_must_be_an_object");

  const supabase = createAnonClient();
  // 120 submissions a minute per key; a form flood can't fill the CRM.
  const { data: allowed } = await supabase.rpc("api_rate_limit", { p_api_key: apiKey });
  if (allowed === false) return { ...fail(429, "rate_limited"), headers: { "retry-after": "60" } };

  const { data: business, error: keyError } = await supabase.rpc("api_key_business", { p_api_key: apiKey }).maybeSingle();
  if (keyError) return fail(500, "internal_error");
  if (!business) return fail(401, "invalid_api_key");

  const country = (business as { country_code: string }).country_code as CountryCode;
  const parsed = parseLeadPayload(body, country);
  if (!parsed.ok) return fail(422, "invalid_lead", parsed.errors);

  const { data, error } = await supabase.rpc("api_submit_lead", {
    p_api_key: apiKey,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash(body),
    p_input: parsed.input,
  });
  if (error) {
    if (error.code === "28000") return fail(401, "invalid_api_key");
    if (error.code === "P0409") return fail(409, "idempotency_key_reused");
    if (error.code === "22023" || error.code === "23514" || error.code === "22P02") {
      return fail(422, "invalid_lead", { body: error.message });
    }
    return fail(500, "internal_error");
  }

  const r = data as Record<string, unknown>;
  return {
    status: r.lead_created && !r.replayed ? 201 : 200,
    body: {
      lead_id: r.lead_id,
      lead_number: r.lead_number,
      customer_id: r.customer_id,
      cif_number: r.cif_number,
      lead_created: r.lead_created,
      customer_created: r.customer_created,
      replayed: r.replayed,
    },
  };
}
