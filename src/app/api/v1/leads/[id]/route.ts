import { handleApi } from "@/modules/api/http";
import { getResource, updateLead } from "@/modules/api/resources";

export async function GET(request: Request, { params }: RouteContext<"/api/v1/leads/[id]">) {
  const { id } = await params;
  return handleApi(request, (ctx) => getResource(ctx, "leads", id));
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/v1/leads/[id]">) {
  const { id } = await params;
  return handleApi(request, (ctx) => updateLead(ctx, id));
}
