import { handleApi } from "@/modules/api/http";
import { createWebhook, listWebhooks } from "@/modules/api/resources";

export function GET(request: Request) {
  return handleApi(request, listWebhooks);
}

export function POST(request: Request) {
  return handleApi(request, createWebhook);
}
