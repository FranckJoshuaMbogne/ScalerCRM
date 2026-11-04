import { toCsv } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";
import { can, getContext } from "@/modules/tenancy/session";

const MAX_ROWS = 10_000;

/**
 * CSV exports. Rows are read with the signed-in user's client, so an export
 * contains exactly what that person can see; each export is audited.
 */
export async function GET(request: Request, routeCtx: RouteContext<"/api/export/[kind]">) {
  const { kind } = await routeCtx.params;
  const ctx = await getContext();
  const supabase = await createClient();
  const biz = ctx.business.businessId;
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  let csv: string;
  let rows = 0;

  if (kind === "leads") {
    if (!can(ctx, "leads.export")) return new Response("forbidden", { status: 403 });
    let q = supabase
      .from("leads")
      .select("lead_number, title, expected_value, score, created_at, closed_at, first_campaign, first_touch, status:lead_statuses(name), source:lead_sources!leads_business_id_first_source_id_fkey(name), customer:customers(cif_number, full_name, primary_phone, primary_email), owner:profiles!leads_owner_id_fkey(full_name)")
      .eq("business_id", biz)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", `${to}T23:59:59`);
    const { data, error } = await q;
    if (error) return new Response(error.message, { status: 500 });
    type R = Record<string, unknown> & { status: { name: string } | null; source: { name: string } | null; customer: Record<string, string> | null; owner: { full_name: string } | null; first_touch: Record<string, string> };
    const list = (data ?? []) as unknown as R[];
    rows = list.length;
    csv = toCsv(list, [
      { header: "Lead", value: (r) => r.lead_number },
      { header: "Created", value: (r) => r.created_at },
      { header: "Customer", value: (r) => r.customer?.full_name },
      { header: "CIF", value: (r) => r.customer?.cif_number },
      { header: "Phone", value: (r) => r.customer?.primary_phone },
      { header: "Email", value: (r) => r.customer?.primary_email },
      { header: "Stage", value: (r) => r.status?.name },
      { header: "Source", value: (r) => r.source?.name },
      { header: "Campaign", value: (r) => r.first_campaign },
      { header: "Campaign ID", value: (r) => r.first_touch?.campaign_id },
      { header: "Owner", value: (r) => r.owner?.full_name },
      { header: "Interest", value: (r) => r.title },
      { header: "Expected value", value: (r) => r.expected_value },
      { header: "Score", value: (r) => r.score },
      { header: "Closed", value: (r) => r.closed_at },
    ]);
  } else if (kind === "customers") {
    if (!can(ctx, "customers.export")) return new Response("forbidden", { status: 403 });
    const { data, error } = await supabase
      .from("customers")
      .select("cif_number, full_name, primary_phone, primary_email, gender, date_of_birth, created_at")
      .eq("business_id", biz)
      .is("merged_into_id", null)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);
    if (error) return new Response(error.message, { status: 500 });
    rows = data?.length ?? 0;
    csv = toCsv(data ?? [], [
      { header: "CIF", value: (r) => r.cif_number },
      { header: "Name", value: (r) => r.full_name },
      { header: "Phone", value: (r) => r.primary_phone },
      { header: "Email", value: (r) => r.primary_email },
      { header: "Gender", value: (r) => r.gender },
      { header: "Date of birth", value: (r) => r.date_of_birth },
      { header: "Customer since", value: (r) => r.created_at },
    ]);
  } else if (kind === "orders") {
    if (!can(ctx, "reports.export")) return new Response("forbidden", { status: 403 });
    let q = supabase
      .from("orders")
      .select("id, order_number, created_at, due_date, subtotal, discount_total, tax_total, total, closed_at, stage:order_stages(name), customer:customers(cif_number, full_name, primary_phone)")
      .eq("business_id", biz)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", `${to}T23:59:59`);
    const { data, error } = await q;
    if (error) return new Response(error.message, { status: 500 });
    type R = Record<string, unknown> & { id: string; stage: { name: string } | null; customer: Record<string, string> | null };
    const list = (data ?? []) as unknown as R[];
    const { data: balances } = list.length
      ? await supabase.from("order_balances").select("order_id, net_paid, balance").in("order_id", list.map((o) => o.id).slice(0, 1000))
      : { data: [] };
    const bal = new Map((balances ?? []).map((b) => [b.order_id, b]));
    rows = list.length;
    csv = toCsv(list, [
      { header: "Order", value: (r) => r.order_number },
      { header: "Created", value: (r) => r.created_at },
      { header: "Customer", value: (r) => r.customer?.full_name },
      { header: "CIF", value: (r) => r.customer?.cif_number },
      { header: "Phone", value: (r) => r.customer?.primary_phone },
      { header: "Stage", value: (r) => r.stage?.name },
      { header: "Delivery date", value: (r) => r.due_date },
      { header: "Subtotal", value: (r) => r.subtotal },
      { header: "Discounts", value: (r) => r.discount_total },
      { header: "Tax", value: (r) => r.tax_total },
      { header: "Total", value: (r) => r.total },
      { header: "Paid", value: (r) => bal.get(r.id)?.net_paid },
      { header: "Balance", value: (r) => bal.get(r.id)?.balance },
    ]);
  } else {
    return new Response("not found", { status: 404 });
  }

  await supabase.rpc("log_export", { p_business_id: biz, p_kind: kind, p_rows: rows });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
