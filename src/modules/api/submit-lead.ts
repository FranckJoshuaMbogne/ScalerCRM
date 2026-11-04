import "server-only";
import type { CountryCode } from "libphonenumber-js";
import { ApiFailure, type ApiContext, readJsonBody, rpc } from "./http";
import { parseLeadPayload, requestHash } from "./lead-payload";

/**
 * POST /api/v1/leads: one enquiry from a website form or partner.
 * The request hash stays the Sprint 2 one (body only), so retries of requests
 * sent before Sprint 13 still match.
 */
export async function submitLead({ request, apiKey, supabase, idempotencyKey }: ApiContext) {
  const body = await readJsonBody(request);
  const business = await rpc<{ country_code: string }[] | { country_code: string } | null>(
    supabase,
    "api_key_business",
    { p_api_key: apiKey },
  );
  const row = Array.isArray(business) ? business[0] : business;
  if (!row) throw new ApiFailure(401, "invalid_api_key", "The API key is wrong or revoked.");

  const parsed = parseLeadPayload(body, row.country_code as CountryCode);
  if (!parsed.ok) throw new ApiFailure(422, "invalid_lead", undefined, parsed.errors);

  const r = await rpc<Record<string, unknown>>(supabase, "api_submit_lead", {
    p_api_key: apiKey,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash(body),
    p_input: parsed.input,
  }).catch((e: unknown) => {
    if (e instanceof ApiFailure && e.status === 422) throw new ApiFailure(422, "invalid_lead", undefined, { body: e.message });
    throw e;
  });
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
