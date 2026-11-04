import "server-only";
import { createClient } from "@/lib/supabase/server";

export type WebhookEndpointRow = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  secretPrefix: string;
  isActive: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
};

export type DeliveryRow = {
  id: number;
  eventId: number;
  eventType: string;
  status: "pending" | "sending" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  nextAttemptAt: string;
  lastStatusCode: number | null;
  lastError: string | null;
  durationMs: number | null;
  deliveredAt: string | null;
  replayOf: number | null;
  createdAt: string;
};

const ENDPOINT_COLUMNS =
  "id, url, description, events, secret_prefix, is_active, disabled_reason, consecutive_failures, last_success_at, last_failure_at, created_at";

type EndpointDb = {
  id: string; url: string; description: string | null; events: string[]; secret_prefix: string; is_active: boolean;
  disabled_reason: string | null; consecutive_failures: number; last_success_at: string | null; last_failure_at: string | null;
  created_at: string;
};

const toEndpoint = (e: EndpointDb): WebhookEndpointRow => ({
  id: e.id,
  url: e.url,
  description: e.description,
  events: e.events,
  secretPrefix: e.secret_prefix,
  isActive: e.is_active,
  disabledReason: e.disabled_reason,
  consecutiveFailures: e.consecutive_failures,
  lastSuccessAt: e.last_success_at,
  lastFailureAt: e.last_failure_at,
  createdAt: e.created_at,
});

export async function listWebhookEndpoints(businessId: string): Promise<WebhookEndpointRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select(ENDPOINT_COLUMNS)
    .eq("business_id", businessId)
    .order("created_at");
  if (error) throw new Error(`Could not load webhook endpoints: ${error.message}`);
  return ((data ?? []) as EndpointDb[]).map(toEndpoint);
}

export async function getWebhookEndpoint(businessId: string, id: string): Promise<WebhookEndpointRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select(ENDPOINT_COLUMNS)
    .eq("business_id", businessId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the webhook endpoint: ${error.message}`);
  return data ? toEndpoint(data as EndpointDb) : null;
}

/** The latest deliveries for an endpoint, newest first. */
export async function listDeliveries(businessId: string, endpointId: string, limit = 50): Promise<DeliveryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("webhook_deliveries")
    .select("id, event_id, status, attempts, next_attempt_at, last_status_code, last_error, duration_ms, delivered_at, replay_of, created_at, webhook_events(type)")
    .eq("business_id", businessId)
    .eq("endpoint_id", endpointId)
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load deliveries: ${error.message}`);
  return (data ?? []).map((d) => {
    const event = d.webhook_events as unknown as { type: string } | { type: string }[] | null;
    return {
      id: d.id,
      eventId: d.event_id,
      eventType: (Array.isArray(event) ? event[0]?.type : event?.type) ?? "",
      status: d.status as DeliveryRow["status"],
      attempts: d.attempts,
      nextAttemptAt: d.next_attempt_at,
      lastStatusCode: d.last_status_code,
      lastError: d.last_error,
      durationMs: d.duration_ms,
      deliveredAt: d.delivered_at,
      replayOf: d.replay_of,
      createdAt: d.created_at,
    };
  });
}
