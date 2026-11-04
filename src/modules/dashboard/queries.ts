import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fromPaise, toScaled } from "@/modules/orders/money";

function sum(values: (string | number | null)[], sign: (i: number) => 1 | -1 = () => 1) {
  let total = BigInt(0);
  values.forEach((v, i) => {
    const n = toScaled(String(v ?? "0"), 2) ?? BigInt(0);
    total += sign(i) === 1 ? n : -n;
  });
  return fromPaise(total);
}

/**
 * Headline figures for the last 30 days. Every query runs as the user,
 * so each person sees the figures for the records they can see.
 */
export async function getKpis(businessId: string, openStageIds: string[], cancelledStageIds: string[], opts: { payments: boolean }) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const none = "00000000-0000-0000-0000-000000000000";
  const [leads, walkIns, orders, payments, balances] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("created_at", since),
    supabase.from("walk_ins").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("visited_at", since),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("created_at", since)
      .not("stage_id", "in", `(${cancelledStageIds.join(",") || none})`),
    opts.payments
      ? supabase.from("payments").select("kind, amount").eq("business_id", businessId).gte("received_at", since).limit(5000)
      : Promise.resolve({ data: null }),
    supabase
      .from("order_balances")
      .select("balance")
      .eq("business_id", businessId)
      .in("stage_id", openStageIds.length ? openStageIds : [none])
      .gt("balance", 0)
      .limit(5000),
  ]);
  const pay = payments.data ?? null;
  return {
    newLeads: leads.count ?? 0,
    walkIns: walkIns.count ?? 0,
    orders: orders.count ?? 0,
    revenue: pay ? sum(pay.map((p) => p.amount), (i) => (pay[i].kind === "refund" ? -1 : 1)) : null,
    outstanding: sum((balances.data ?? []).map((b) => b.balance)),
  };
}
