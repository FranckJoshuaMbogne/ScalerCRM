import { handleApi } from "@/modules/api/http";
import { getResource, updateOrder } from "@/modules/api/resources";

export async function GET(request: Request, { params }: RouteContext<"/api/v1/orders/[id]">) {
  const { id } = await params;
  return handleApi(request, (ctx) => getResource(ctx, "orders", id));
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/v1/orders/[id]">) {
  const { id } = await params;
  return handleApi(request, (ctx) => updateOrder(ctx, id));
}
