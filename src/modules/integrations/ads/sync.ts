import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleSpend, metaSpend } from "./clients";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Pulls the last 30 days of spend for accounts not synced in 6 hours. Re-syncing a day replaces it. */
export async function runAdSync() {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ad_accounts_due", { p_limit: 10 });
  if (error) throw new Error(`ad_accounts_due failed: ${error.message}`);
  const until = day(new Date());
  const since = day(new Date(Date.now() - 30 * 86400_000));
  let synced = 0;
  for (const a of (data ?? []) as { id: string; platform: string; external_id: string; login_customer_id: string | null; token: string }[]) {
    const rows = a.platform === "google"
      ? await googleSpend(a.external_id, a.token, a.login_customer_id, since, until)
      : await metaSpend(a.external_id, a.token, since, until);
    await admin.rpc("upsert_ad_spend", { p_account_id: a.id, p_rows: rows.ok ? rows.value : [], p_error: rows.ok ? null : rows.error });
    if (rows.ok) synced++;
  }
  return { synced };
}
