import { submitLead } from "@/modules/api/submit-lead";

/**
 * Public lead intake for website forms.
 *   POST /api/v1/leads
 *   Authorization: Bearer <api key>
 *   Idempotency-Key: <unique per form submission>   (optional, recommended)
 * See docs/api.md.
 */
export async function POST(request: Request) {
  const result = await submitLead(request);
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
