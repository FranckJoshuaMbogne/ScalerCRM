import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processLeadEvent } from "@/modules/integrations/leads/process";
import { parseLeadgenWebhook } from "@/modules/integrations/leads/mapping";
import { metaConfig } from "@/modules/integrations/whatsapp/config";
import { verifySignature } from "@/modules/integrations/whatsapp/webhook";

/**
 * Meta Lead Ads (Page webhooks, field "leadgen"). Same pattern as WhatsApp:
 * verify the signature, store each lead id (deduplicated), answer 200, then
 * fetch and process the lead after the response.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { verifyToken } = metaConfig();
  if (verifyToken && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === verifyToken) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), metaConfig().appSecret)) {
    return new Response("invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const admin = createAdminClient();
  const stored: number[] = [];
  try {
    for (const item of parseLeadgenWebhook(payload)) {
      const { data: businessId } = await admin.rpc("meta_page_business", { p_page_id: item.pageId });
      const { data, error } = await admin.rpc("record_lead_event", {
        p_provider: "meta_leadgen",
        p_external_id: item.leadgenId,
        p_business_id: businessId ?? null,
        p_payload: { leadgen_id: item.leadgenId, page_id: item.pageId, form_id: item.formId, ad_id: item.adId },
      });
      if (error) throw new Error(error.message);
      if (data !== null && businessId) stored.push(Number(data));
    }
  } catch (e) {
    console.error("[leadgen webhook]", e);
    return new Response("retry", { status: 500 });
  }
  after(async () => {
    for (const id of stored) await processLeadEvent(admin, id);
  });
  return new Response("ok", { status: 200 });
}
