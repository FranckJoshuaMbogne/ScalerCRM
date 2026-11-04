import { handleApi } from "@/modules/api/http";
import { getResource } from "@/modules/api/resources";

export async function GET(request: Request, { params }: RouteContext<"/api/v1/payments/[id]">) {
  const { id } = await params;
  return handleApi(request, (ctx) => getResource(ctx, "payments", id));
}
