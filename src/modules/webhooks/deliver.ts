import "server-only";
import { lookup } from "node:dns/promises";
import { createAdminClient } from "@/lib/supabase/admin";
import { eventEnvelope, type EventRow } from "./envelope";
import { SIGNATURE_HEADER, signPayload } from "./sign";
import { checkWebhookUrl, isPrivateAddress } from "./url-guard";

type Claimed = EventRow & { id: number; url: string; secret: string; attempt: number };

const TIMEOUT_MS = 10_000;
const CONCURRENCY = 10;

/**
 * Sends due webhook deliveries (job route, every 5 minutes; retries follow the
 * back-off in finish_webhook_delivery). Each POST is signed with the endpoint
 * secret. Redirects are not followed and private addresses are refused after
 * DNS resolution.
 */
export async function runWebhookDeliveries() {
  const admin = createAdminClient();
  const result = { sent: 0, failed: 0, disabled: 0, pruned: 0 };
  for (let batch = 0; batch < 5; batch++) {
    const { data, error } = await admin.rpc("claim_webhook_deliveries", { p_limit: 50 });
    if (error) throw new Error(`claim_webhook_deliveries failed: ${error.message}`);
    const rows = (data ?? []) as Claimed[];
    if (!rows.length) break;
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      await Promise.all(
        rows.slice(i, i + CONCURRENCY).map(async (row) => {
          const attempt = await sendOne(row);
          const { data: outcome } = await admin.rpc("finish_webhook_delivery", {
            p_id: row.id,
            p_status_code: attempt.status,
            p_error: attempt.error,
            p_duration_ms: attempt.ms,
          });
          if (outcome === "succeeded") result.sent++;
          else result.failed++;
          if (outcome === "disabled") result.disabled++;
        }),
      );
    }
  }
  const { data: pruned } = await admin.rpc("prune_webhook_log");
  result.pruned = Number(pruned ?? 0);
  return result;
}

export async function sendOne(row: Claimed): Promise<{ status: number | null; error: string | null; ms: number }> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const urlProblem = checkWebhookUrl(row.url);
  if (urlProblem) return { status: null, error: urlProblem, ms: 0 };
  try {
    const host = new URL(row.url).hostname.replace(/^\[|\]$/g, "");
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      return { status: null, error: "The URL resolves to a private address.", ms: ms() };
    }
  } catch {
    return { status: null, error: "The host name could not be resolved.", ms: ms() };
  }

  const body = JSON.stringify(eventEnvelope(row));
  try {
    const res = await fetch(row.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "user-agent": "SCALER-Webhooks/1.0",
        "scaler-event": row.event_type,
        "scaler-delivery": `whd_${row.id}`,
        [SIGNATURE_HEADER]: signPayload(row.secret, body, Math.floor(Date.now() / 1000)),
      },
      body,
    });
    // The receiver's answer body is not stored; only its status.
    await res.body?.cancel().catch(() => {});
    if (res.status >= 300 && res.status < 400) {
      return { status: res.status, error: `Redirect to another address (HTTP ${res.status}); redirects are not followed.`, ms: ms() };
    }
    return { status: res.status, error: null, ms: ms() };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { status: null, error: timedOut ? `No answer within ${TIMEOUT_MS / 1000} seconds.` : `Could not connect: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300), ms: ms() };
  }
}
