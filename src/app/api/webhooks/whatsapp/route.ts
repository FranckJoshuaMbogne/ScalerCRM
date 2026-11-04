import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { metaConfig } from "@/modules/integrations/whatsapp/config";
import { processEvent, recordItems } from "@/modules/integrations/whatsapp/ingest";
import { parseWebhook, verifySignature } from "@/modules/integrations/whatsapp/webhook";

/**
 * One webhook for every connected WhatsApp number (ADR 0002).
 * GET: Meta's verification handshake. POST: verify the signature, store each
 * item (deduplicated), answer 200 at once, then process after the response.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { verifyToken } = metaConfig();
  if (
    verifyToken &&
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === verifyToken
  ) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  const { appSecret } = metaConfig();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response("invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const admin = createAdminClient();
  let stored;
  try {
    stored = await recordItems(admin, parseWebhook(payload));
  } catch (e) {
    // Not stored: answer 500 so Meta retries the delivery.
    console.error("[whatsapp webhook]", e);
    return new Response("retry", { status: 500 });
  }

  after(async () => {
    for (const s of stored) await processEvent(admin, s.id, s.kind, s.payload);
  });
  return new Response("ok", { status: 200 });
}
