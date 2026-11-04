import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processLeadEvent } from "@/modules/integrations/leads/process";
import { fromGoogleLead } from "@/modules/integrations/leads/mapping";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Google Ads lead form webhook. The URL token picks the configuration; the
 * google_key inside the body must match the key set in Google Ads.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/google-leads/[token]">) {
  const { token } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return new Response("not found", { status: 404 });
  const admin = createAdminClient();
  const { data: hook } = await admin.rpc("lead_webhook_by_token", { p_token_hash: sha(token) });
  const config = hook as { id: string; business_id: string; secret_hash: string } | null;
  if (!config) return new Response("not found", { status: 404 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const lead = fromGoogleLead(payload);
  const given = Buffer.from(sha(lead.googleKey ?? ""));
  const wanted = Buffer.from(config.secret_hash);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return new Response("invalid key", { status: 401 });
  // Google's "Send test data" button: acknowledge without creating a lead.
  if (lead.isTest || !lead.leadId) return Response.json({ ok: true, test: true });

  const { data, error } = await admin.rpc("record_lead_event", {
    p_provider: "google_ads",
    p_external_id: `${config.id}:${lead.leadId}`,
    p_business_id: config.business_id,
    p_payload: { ...(payload as object), google_key: undefined, webhook_id: config.id },
  });
  if (error) {
    console.error("[google leads]", error.message);
    return new Response("retry", { status: 500 });
  }
  if (data !== null) after(() => processLeadEvent(admin, Number(data)));
  return Response.json({ ok: true });
}
