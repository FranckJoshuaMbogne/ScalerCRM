import { handleApi } from "@/modules/api/http";
import { listResource } from "@/modules/api/resources";
import { submitLead } from "@/modules/api/submit-lead";

/**
 * GET  /api/v1/leads   (leads:read)  list, oldest change first; see docs/api.md
 * POST /api/v1/leads   (leads:write) an enquiry from a website form or partner
 */
export function GET(request: Request) {
  return handleApi(request, (ctx) => listResource(ctx, "leads"));
}

export function POST(request: Request) {
  return handleApi(request, submitLead);
}
