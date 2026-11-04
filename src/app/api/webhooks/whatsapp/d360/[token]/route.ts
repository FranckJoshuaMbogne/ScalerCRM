import { createHash } from "node:crypto";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processEvent, recordItems } from "@/modules/integrations/whatsapp/ingest";
import { parseWebhook } from "@/modules/integrations/whatsapp/webhook";

/**
 * 360dialog delivers Cloud API-shaped webhooks without Meta's signature, so the
 * account is identified by an unguessable token in the URL (only its hash is stored).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/whatsapp/d360/[token]">) {
  const { token } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return new Response("not found", { status: 404 });
  const admin = createAdminClient();
  const { data: accountId } = await admin.rpc("whatsapp_account_by_webhook_token", {
    p_token_hash: createHash("sha256").update(token).digest("hex"),
  });
  if (!accountId) return new Response("not found", { status: 404 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }
  let stored;
  try {
    stored = await recordItems(admin, parseWebhook(payload), String(accountId));
  } catch (e) {
    console.error("[360dialog webhook]", e);
    return new Response("retry", { status: 500 });
  }
  after(async () => {
    for (const s of stored) await processEvent(admin, s.id, s.kind, s.payload);
  });
  return new Response("ok", { status: 200 });
}
