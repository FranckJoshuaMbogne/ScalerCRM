import { handleApi } from "@/modules/api/http";
import { createOrder, listResource } from "@/modules/api/resources";

export function GET(request: Request) {
  return handleApi(request, (ctx) => listResource(ctx, "orders"));
}

export function POST(request: Request) {
  return handleApi(request, createOrder);
}
