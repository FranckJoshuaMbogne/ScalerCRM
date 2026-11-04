import { handleApi } from "@/modules/api/http";
import { deleteWebhook, updateWebhook } from "@/modules/api/resources";

export async function PATCH(request: Request, { params }: RouteContext<"/api/v1/webhooks/[id]">) {
  const { id } = await params;
  return handleApi(request, (ctx) => updateWebhook(ctx, id));
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/v1/webhooks/[id]">) {
  const { id } = await params;
  return handleApi(request, (ctx) => deleteWebhook(ctx, id));
}
