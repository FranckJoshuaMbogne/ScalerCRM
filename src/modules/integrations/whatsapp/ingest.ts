import "server-only";
import type { CountryCode } from "libphonenumber-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalisePhone } from "@/modules/crm/phone";
import { metaCloud } from "./meta-cloud";
import type { InboundMessage, StatusUpdate, WebhookItem } from "./webhook";

type Admin = ReturnType<typeof createAdminClient>;

/** Stores each item before the webhook is acknowledged. Duplicates come back as null. */
export async function recordItems(admin: Admin, items: WebhookItem[]) {
  const stored: { id: number; kind: WebhookItem["kind"]; payload: WebhookItem["item"] }[] = [];
  for (const it of items) {
    const { data, error } = await admin.rpc("record_webhook_event", {
      p_provider: "meta",
      p_external_id: it.externalId,
      p_kind: it.kind,
      p_phone_number_id: it.phoneNumberId,
      p_payload: it.item,
    });
    if (error) throw new Error(`record_webhook_event failed: ${error.message}`);
    if (data !== null) stored.push({ id: Number(data), kind: it.kind, payload: it.item });
  }
  return stored;
}

/**
 * Processes one stored event. wa_id has no "+", so it is normalised through
 * normalisePhone() (the only way phones are matched). Failures stay pending
 * and are retried by the job route, up to five attempts.
 */
export async function processEvent(admin: Admin, id: number, kind: string, payload: unknown) {
  try {
    if (kind === "message") {
      const m = payload as InboundMessage;
      // Country only matters for numbers without a code; wa_id always has one.
      const phone = normalisePhone(`+${m.from}`, "IN" as CountryCode);
      if (!phone) throw new Error(`unusable sender ${m.from}`);
      const { error } = await admin.rpc("ingest_whatsapp_message", {
        p_event_id: id,
        p_message: {
          wamid: m.wamid,
          phone,
          profile_name: m.profileName,
          type: m.type,
          body: m.body,
          media: m.media,
          sent_at: m.sentAt,
        },
      });
      if (error) throw new Error(error.message);
    } else if (kind === "status") {
      const s = payload as StatusUpdate;
      const { error } = await admin.rpc("apply_whatsapp_status", {
        p_event_id: id,
        p_status: { wamid: s.wamid, status: s.status, at: s.at, errors: s.errors },
      });
      if (error) throw new Error(error.message);
    } else {
      await admin.rpc("finish_webhook_event", { p_event_id: id, p_error: null });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "processing failed";
    console.error(`[whatsapp] event ${id}:`, message);
    await admin.rpc("finish_webhook_event", { p_event_id: id, p_error: message });
  }
}

/** Retries events whose first attempt failed or never ran (called by the job route). */
export async function retryPendingEvents(admin: Admin) {
  const { data, error } = await admin.rpc("pending_webhook_events", { p_limit: 50 });
  if (error) throw new Error(`pending_webhook_events failed: ${error.message}`);
  const rows = (data ?? []) as { id: number; kind: string; payload: unknown }[];
  for (const r of rows) await processEvent(admin, r.id, r.kind, r.payload);
  return rows.length;
}

/** Sends one queued reply through the provider and records the outcome. */
export async function sendQueuedMessage(messageId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("whatsapp_send_context", { p_message_id: messageId });
  if (error || !data) return { ok: false as const, error: error?.message ?? "message is not queued" };
  const ctx = data as { body: string; to: string | null; phone_number_id: string; token: string | null };
  if (!ctx.to || !ctx.token) {
    await admin.rpc("record_whatsapp_send", { p_message_id: messageId, p_wamid: null, p_error: { message: "missing number or token" } });
    return { ok: false as const, error: "The customer has no phone number, or the WhatsApp number needs reconnecting." };
  }
  const sent = await metaCloud.sendText(ctx.phone_number_id, ctx.token, ctx.to, ctx.body);
  await admin.rpc("record_whatsapp_send", {
    p_message_id: messageId,
    p_wamid: sent.ok ? sent.value.wamid : null,
    p_error: sent.ok ? null : { message: sent.error, code: sent.code ?? null },
  });
  return sent.ok ? { ok: true as const } : { ok: false as const, error: sent.error };
}
