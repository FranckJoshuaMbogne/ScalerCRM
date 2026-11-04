import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { saveAttributionSettings } from "@/modules/integrations/ads-actions";
import { listSources } from "@/modules/leads/config";
import { fromPaise, toScaled } from "@/modules/orders/money";
import { localDateKey } from "@/modules/tasks/schedule";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Attribution" };

type Row = {
  source_id: string | null; campaign: string | null; campaign_id: string | null; leads: number;
  first_orders: number; first_revenue: string; last_orders: number; last_revenue: string;
  linear_revenue: string; assisted_orders: number; spend: string | null;
};

const MODELS = { first_touch: "First touch", last_touch: "Last touch", linear: "Linear (split evenly)" } as const;
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function ratio(revenue: string, spend: string | null) {
  const s = toScaled(spend ?? "0", 2) ?? BigInt(0);
  if (s === BigInt(0)) return "—";
  const r = toScaled(revenue, 2) ?? BigInt(0);
  return `${(Number((r * BigInt(100)) / s) / 100).toFixed(2)}×`;
}

function perLead(spend: string | null, leads: number) {
  const s = toScaled(spend ?? "0", 2) ?? BigInt(0);
  return leads && s ? fromPaise(s / BigInt(leads)) : null;
}

export default async function AttributionPage({ searchParams }: PageProps<"/analytics/attribution">) {
  const ctx = await getContext();
  if (!can(ctx, "analytics.marketing") && !can(ctx, "analytics.view")) return <NoAccess what="attribution" />;
  const sp = await searchParams;
  const tz = ctx.business.timezone;
  const today = localDateKey(new Date(), tz);
  const to = DATE.test(one(sp.to)) ? one(sp.to) : today;
  const from = DATE.test(one(sp.from)) ? one(sp.from) : localDateKey(daysAgo(30), tz);
  const supabase = await createClient();
  const [{ data }, { data: settings }, sources] = await Promise.all([
    supabase.rpc("attribution_report", { p_business_id: ctx.business.businessId, p_from: from, p_to: to }),
    supabase.from("attribution_settings").select("model, lookback_days").eq("business_id", ctx.business.businessId).maybeSingle(),
    listSources(ctx.business.businessId),
  ]);
  const rows = (data ?? []) as Row[];
  const model = (settings?.model ?? "last_touch") as keyof typeof MODELS;
  const credited = (r: Row) => (model === "first_touch" ? r.first_revenue : model === "linear" ? r.linear_revenue : r.last_revenue);
  const source = new Map(sources.map((s) => [s.id, s.name]));
  const cur = ctx.business.currency;
  const input = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[13.5px]";

  return (
    <>
      <Link href="/integrations" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Integrations</Link>
      <PageHeader
        title="Attribution"
        description={`Which sources and campaigns bring leads and orders. Revenue is credited by your policy (${MODELS[model].toLowerCase()}, ${settings?.lookback_days ?? 90}-day lookback); the other models are shown for comparison.`}
      />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">From<input type="date" name="from" defaultValue={from} className={input} /></label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">To<input type="date" name="to" defaultValue={to} className={input} /></label>
        <button type="submit" className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 text-[13.5px] font-medium hover:bg-paper">Apply</button>
      </form>

      <Panel className="mb-6">
        {rows.length === 0 ? (
          <EmptyState title="Nothing in this period" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] tabular-nums">
              <thead className="border-b border-line text-left text-[12px] text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Source / campaign</th>
                  <th className="px-3 py-2 text-right font-medium">Leads</th>
                  <th className="px-3 py-2 text-right font-medium">Spend</th>
                  <th className="px-3 py-2 text-right font-medium">Per lead</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue ({MODELS[model].split(" (")[0].toLowerCase()})</th>
                  <th className="px-3 py-2 text-right font-medium">ROAS</th>
                  <th className="px-3 py-2 text-right font-medium">First touch</th>
                  <th className="px-3 py-2 text-right font-medium">Last touch</th>
                  <th className="px-3 py-2 text-right font-medium">Linear</th>
                  <th className="px-4 py-2 text-right font-medium">Assisted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r, i) => {
                  const cpl = perLead(r.spend, r.leads);
                  return (
                    <tr key={i}>
                      <td className="px-4 py-2">
                        <p className="font-medium">{(r.source_id && source.get(r.source_id)) ?? "No source"}</p>
                        <p className="text-[12px] text-muted">{r.campaign ?? r.campaign_id ?? "No campaign"}</p>
                      </td>
                      <td className="px-3 py-2 text-right">{r.leads}</td>
                      <td className="px-3 py-2 text-right">{r.spend ? formatMoney(r.spend, cur) : "—"}</td>
                      <td className="px-3 py-2 text-right">{cpl ? formatMoney(cpl, cur) : "—"}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatMoney(credited(r), cur)}</td>
                      <td className="px-3 py-2 text-right">{ratio(credited(r), r.spend)}</td>
                      <td className="px-3 py-2 text-right">{r.first_orders} · {formatMoney(r.first_revenue, cur)}</td>
                      <td className="px-3 py-2 text-right">{r.last_orders} · {formatMoney(r.last_revenue, cur)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(r.linear_revenue, cur)}</td>
                      <td className="px-4 py-2 text-right">{r.assisted_orders}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {can(ctx, "analytics.marketing") && (
        <Panel className="max-w-xl p-5">
          <h2 className="mb-1 text-[15px] font-semibold">Revenue attribution policy</h2>
          <p className="mb-3 text-[13px] text-muted">Which touch gets credit for an order, and how far back to look. Changes are audited.</p>
          <ActionForm action={saveAttributionSettings} className="flex flex-wrap items-end gap-3">
            <SelectField label="Model" name="model" defaultValue={model} options={Object.entries(MODELS).map(([value, label]) => ({ value, label }))} />
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">Lookback (days)
              <input name="lookbackDays" type="number" min={1} max={365} defaultValue={settings?.lookback_days ?? 90} className={`${input} w-28`} />
            </label>
            <SubmitButton variant="secondary">Save policy</SubmitButton>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
