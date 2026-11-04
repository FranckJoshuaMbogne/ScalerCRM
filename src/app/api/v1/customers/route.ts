import { handleApi } from "@/modules/api/http";
import { listResource } from "@/modules/api/resources";

export function GET(request: Request) {
  return handleApi(request, (ctx) => listResource(ctx, "customers"));
}
