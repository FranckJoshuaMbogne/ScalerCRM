import { reportError } from "@/lib/monitoring";
import { ingestWebhook } from "@/modules/billing/ingest";
import { providerByName } from "@/modules/billing/provider";

/**
 * Payment provider webhooks (Razorpay: /api/webhooks/billing/razorpay).
 * The signature is checked on the raw body; each provider event id is applied once.
 * A 500 makes the provider retry; anything stored (even as failed) returns 200.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/billing/[provider]">) {
  const { provider: name } = await ctx.params;
  const provider = providerByName(name);
  if (!provider) return new Response("not found", { status: 404 });
  const body = await request.text();
  if (body.length > 256_000) return new Response("too large", { status: 413 });
  try {
    const result = await ingestWebhook(provider, body, request.headers);
    return new Response(result.body, { status: result.httpStatus });
  } catch (e) {
    await reportError(e, { route: "billing_webhook", provider: name });
    return new Response("retry", { status: 500 });
  }
}
