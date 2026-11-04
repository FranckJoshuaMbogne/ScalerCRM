import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { type VapidKeys, vapidAuthorization, vapidPrivateKey } from "./vapid";

export function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

type Claimed = { subscription_id: string; endpoint: string };

/**
 * Wakes each device that has new notifications. The push is empty; the service
 * worker then fetches the notification itself with the user's session.
 */
export async function runPushes() {
  const keys = vapidKeys();
  if (!keys) return { skipped: true };
  const key = vapidPrivateKey(keys);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_push_batch", { p_limit: 500 });
  if (error) throw new Error(`claim_push_batch failed: ${error.message}`);
  const subs = (data ?? []) as Claimed[];
  const out = { sent: 0, gone: 0, failed: 0 };

  for (let i = 0; i < subs.length; i += 20) {
    await Promise.all(
      subs.slice(i, i + 20).map(async (s) => {
        let status: "ok" | "gone" | "failed" = "failed";
        try {
          const res = await fetch(s.endpoint, {
            method: "POST",
            headers: { authorization: vapidAuthorization(s.endpoint, keys, key), ttl: "86400", urgency: "high", "content-length": "0" },
            signal: AbortSignal.timeout(10_000),
          });
          status = res.ok ? "ok" : res.status === 404 || res.status === 410 ? "gone" : "failed";
        } catch {
          status = "failed";
        }
        out[status === "ok" ? "sent" : status]++;
        await admin.rpc("record_push_result", { p_subscription_id: s.subscription_id, p_status: status });
      }),
    );
  }
  return out;
}
