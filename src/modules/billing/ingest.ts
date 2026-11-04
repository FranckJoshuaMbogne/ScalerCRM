import "server-only";
import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BillingEvent, BillingProvider } from "./types";

export type IngestResult = { status: "applied" | "duplicate" | "failed"; result?: string | null; error?: string | null };

/** Stores and applies one event. Idempotent per provider event id. */
export async function ingestEvent(provider: string, eventId: string, eventType: string, payload: unknown, event: BillingEvent) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("billing_ingest", {
    p_provider: provider,
    p_event_id: eventId,
    p_event_type: eventType,
    p_payload: payload as never,
    p_normalized: event as never,
  });
  if (error) throw new Error(`billing_ingest failed: ${error.message}`);
  return data as IngestResult;
}

/** A provider webhook: verify the signature on the raw body, normalise, ingest. */
export async function ingestWebhook(provider: BillingProvider, rawBody: string, headers: Headers) {
  if (!provider.verifyWebhook(rawBody, headers)) return { httpStatus: 401, body: "bad signature" } as const;
  let parsed;
  try {
    parsed = provider.parseWebhook(rawBody, headers);
  } catch {
    return { httpStatus: 400, body: "bad payload" } as const;
  }
  const result = await ingestEvent(provider.name, parsed.eventId, parsed.eventType, parsed.payload, parsed.event);
  // Stored but not applied (e.g. an unknown subscription): a person looks at it on the platform console.
  if (result.status === "failed")
    await reportError(new Error(`billing event not applied: ${result.error}`), { job: "billing_webhook", event: parsed.eventType });
  return { httpStatus: 200, body: result.status } as const;
}
