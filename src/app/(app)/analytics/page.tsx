import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { SavedViews } from "@/components/crm/saved-views";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { change, formatMetric, METRICS, type MetricKey } from "@/modules/analytics/metrics";
import { previousPeriod, resolvePeriod, PRESETS } from "@/modules/analytics/period";
import { getBreakdown, getOperations, getPicPerformance, getSummary, listSavedViews } from "@/modules/analytics/queries";
import { localDateKey } from "@/modules/tasks/schedule";
import { can, getContext } from "@/modules/tenancy/session";
import { PrintButton } from "./print-button";

export const metadata = { title: "Analytics" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TABS = [
  { key: "executive", label: "Executive", metrics: ["leads", "conversion_rate", "orders", "revenue", "collected", "outstanding", "walk_ins", "tasks_overdue"] },
  { key: "marketing", label: "Marketing", metrics: ["leads", "conversion_rate", "spend", "revenue", "median_first_reply_seconds", "leads_lost"] },
  { key: "sales", label: "Sales", metrics: ["leads", "leads_won", "conversion_rate", "orders", "average_order_value", "tasks_overdue"] },
  { key: "operations", label: "Operations", metrics: ["orders", "appointments", "no_show_rate", "walk_ins", "outstanding", "collected"] },
] as const;
const PRESET_LABEL: Record<string, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", month: "This month", last_month: "Last month" };

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span aria-hidden className="block h-1.5 rounded-full bg-line">
      <span className="block h-1.5 rounded-full bg-signal" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%` }} />
    </span>
  );
}

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const ctx = await getContext();
  if (!can(ctx, "analytics.view")) return <NoAccess what="analytics" />;
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === one(sp.tab)) ?? TABS[0];
  const period = resolvePeriod({ preset: one(sp.preset), from: one(sp.from), to: one(sp.to) }, localDateKey(new Date(), ctx.business.timezone));
  const prev = previousPeriod(period);
  const biz = ctx.business.businessId;
  const cur = ctx.business.currency;
  const dimension = tab.key === "marketing" ? "source" : tab.key === "sales" ? "owner" : tab.key === "operations" ? "product" : "branch";

  const [summary, previous, breakdown, campaigns, products, pic, ops, views] = await Promise.all([
    getSummary(biz, period.from, period.to),
    getSummary(biz, prev.from, prev.to),
    getBreakdown(biz, period.from, period.to, dimension === "product" ? "source" : dimension),
    tab.key === "marketing" ? getBreakdown(biz, period.from, period.to, "campaign") : Promise.resolve([]),
    tab.key === "sales" || tab.key === "operations" ? getBreakdown(biz, period.from, period.to, "product") : Promise.resolve([]),
    tab.key === "sales" ? getPicPerformance(biz, period.from, period.to) : Promise.resolve([]),
    tab.key === "operations" ? getOperations(biz) : Promise.resolve(null),
    listSavedViews(biz, "analytics", ctx.user.id),
  ]);
  const query = new URLSearchParams({ tab: tab.key, from: period.from, to: period.to }).toString();
  const money = (v: unknown) => formatMetric(v, "money", cur);
  const maxLeads = Math.max(0, ...breakdown.map((b) => Number(b.leads ?? 0)));

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`${period.label} (${period.from} to ${period.to}), compared with ${prev.from} to ${prev.to}.`}
        actions={
          <>
            <Link href="/analytics/attribution" className={linkButton.secondary}>Attribution</Link>
            {can(ctx, "reports.export") && (
              <a href={`/api/export/orders?from=${period.from}&to=${period.to}`} className={linkButton.secondary}><Download className="size-4" /> Orders CSV</a>
            )}
            {can(ctx, "leads.export") && (
              <a href={`/api/export/leads?from=${period.from}&to=${period.to}`} className={linkButton.secondary}><Download className="size-4" /> Leads CSV</a>
            )}
            <PrintButton><Printer className="size-4" /> PDF</PrintButton>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        <nav aria-label="Dashboards" className="flex gap-1">
          {TABS.map((t) => (
            <Link key={t.key} href={`/analytics?${new URLSearchParams({ tab: t.key, from: period.from, to: period.to })}`} aria-current={tab.key === t.key ? "page" : undefined}
              className="rounded-full px-3 py-1.5 text-[13px] text-muted hover:bg-surface aria-[current=page]:bg-surface aria-[current=page]:font-medium aria-[current=page]:text-text aria-[current=page]:shadow-sm">
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <Link key={p} href={`/analytics?tab=${tab.key}&preset=${p}`} className="rounded-full border border-line px-2.5 py-1 text-[12.5px] text-muted hover:text-text">{PRESET_LABEL[p]}</Link>
          ))}
        </div>
        <form className="ml-auto flex items-end gap-1.5">
          <input type="hidden" name="tab" value={tab.key} />
          <input type="date" name="from" defaultValue={period.from} aria-label="From" className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13px]" />
          <input type="date" name="to" defaultValue={period.to} aria-label="To" className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13px]" />
          <button type="submit" className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] font-medium">Apply</button>
        </form>
      </div>
      <div className="print:hidden"><SavedViews page="analytics" path="/analytics" views={views} query={query} /></div>

      {!summary ? (
        <Panel><EmptyState title="No figures available for your role" /></Panel>
      ) : (
        <>
          <Panel className="mb-6 grid grid-cols-2 divide-line tabular-nums sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
            {(tab.metrics as readonly MetricKey[]).filter((k) => summary[k] !== null && summary[k] !== undefined).map((k) => {
              const d = change(summary[k], previous?.[k]);
              const good = k === "no_show_rate" || k === "tasks_overdue" || k === "outstanding" || k === "median_first_reply_seconds" || k === "spend" ? (d ?? 0) < 0 : (d ?? 0) > 0;
              return (
                <div key={k} className="px-4 py-4" title={METRICS[k].definition}>
                  <p className="text-[12.5px] text-muted">{METRICS[k].label}</p>
                  <p className="mt-1 text-[22px] font-semibold tracking-tight">{formatMetric(summary[k], METRICS[k].format, cur)}</p>
                  {d !== null && <p className={cn("text-[12px]", good ? "text-stage-won" : "text-danger")}>{d > 0 ? "+" : ""}{d}% vs previous</p>}
                </div>
              );
            })}
          </Panel>

          {tab.key !== "operations" && (
            <Panel className="mb-6">
              <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">
                By {dimension === "source" ? "source" : dimension === "owner" ? "salesperson" : "branch"}
                <span className="block text-[12.5px] font-normal text-muted">Leads created in the period, how many converted, and the orders those customers placed since.</span>
              </h2>
              <table className="w-full text-[13px] tabular-nums">
                <thead className="text-left text-[12px] text-muted">
                  <tr><th className="px-5 py-2 font-medium"> </th><th className="px-3 py-2 text-right font-medium">Leads</th><th className="w-1/5 px-3 py-2" />
                    <th className="px-3 py-2 text-right font-medium">Converted</th><th className="px-3 py-2 text-right font-medium">Rate</th>
                    <th className="px-3 py-2 text-right font-medium">Orders</th><th className="px-5 py-2 text-right font-medium">Order value</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {breakdown.map((b) => (
                    <tr key={b.key}>
                      <td className="px-5 py-2">{b.label}</td>
                      <td className="px-3 py-2 text-right">{b.leads}</td>
                      <td className="px-3 py-2"><Bar value={Number(b.leads ?? 0)} max={maxLeads} /></td>
                      <td className="px-3 py-2 text-right">{b.won}</td>
                      <td className="px-3 py-2 text-right">{b.conversion_rate === null ? "—" : `${b.conversion_rate}%`}</td>
                      <td className="px-3 py-2 text-right">{b.orders}</td>
                      <td className="px-5 py-2 text-right">{b.revenue === null ? "—" : money(b.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {tab.key === "marketing" && (
            <Panel className="mb-6">
              <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">Campaigns: cost per lead and return</h2>
              <table className="w-full text-[13px] tabular-nums">
                <thead className="text-left text-[12px] text-muted">
                  <tr><th className="px-5 py-2 font-medium">Campaign</th><th className="px-3 py-2 text-right font-medium">Leads</th><th className="px-3 py-2 text-right font-medium">Spend</th>
                    <th className="px-3 py-2 text-right font-medium">Per lead</th><th className="px-3 py-2 text-right font-medium">Conversion</th><th className="px-5 py-2 text-right font-medium">ROAS</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {campaigns.filter((c) => c.key !== "(none)").map((c) => {
                    const spend = Number(c.spend ?? 0);
                    return (
                      <tr key={c.key}>
                        <td className="px-5 py-2">{c.label}</td>
                        <td className="px-3 py-2 text-right">{c.leads}</td>
                        <td className="px-3 py-2 text-right">{spend ? money(spend) : "—"}</td>
                        <td className="px-3 py-2 text-right">{spend && c.leads ? money(spend / Number(c.leads)) : "—"}</td>
                        <td className="px-3 py-2 text-right">{c.conversion_rate === null ? "—" : `${c.conversion_rate}%`}</td>
                        <td className="px-5 py-2 text-right">{spend && c.revenue ? `${(Number(c.revenue) / spend).toFixed(2)}×` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}

          {tab.key === "sales" && (
            <Panel className="mb-6">
              <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">
                Salesperson performance
                <span className="block text-[12.5px] font-normal text-muted">
                  Leads at least 7 days old. The index compares each person&apos;s conversions with what the business converts on leads from the same sources (1.00 = as expected).
                </span>
              </h2>
              <table className="w-full text-[13px] tabular-nums">
                <thead className="text-left text-[12px] text-muted">
                  <tr><th className="px-5 py-2 font-medium">Salesperson</th><th className="px-3 py-2 text-right font-medium">Leads</th><th className="px-3 py-2 text-right font-medium">Converted</th>
                    <th className="px-3 py-2 text-right font-medium">Expected</th><th className="px-3 py-2 text-right font-medium">Index</th>
                    <th className="px-3 py-2 text-right font-medium">Days to convert</th><th className="px-5 py-2 text-right font-medium">Overdue tasks</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pic.map((p) => (
                    <tr key={p.owner_id ?? "none"}>
                      <td className="px-5 py-2">{p.owner_name}</td>
                      <td className="px-3 py-2 text-right">{p.leads}</td>
                      <td className="px-3 py-2 text-right">{p.won}</td>
                      <td className="px-3 py-2 text-right">{p.expected_won ?? "—"}</td>
                      <td className={cn("px-3 py-2 text-right font-medium", Number(p.performance_index) >= 1 ? "text-stage-won" : Number(p.performance_index) > 0 ? "text-danger" : "")}>
                        {p.performance_index ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">{p.median_days_to_win ?? "—"}</td>
                      <td className="px-5 py-2 text-right">{p.open_overdue_tasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {(tab.key === "sales" || tab.key === "operations") && products.length > 0 && (
            <Panel className="mb-6">
              <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">By product</h2>
              <ul className="divide-y divide-line text-[13px] tabular-nums">
                {products.slice(0, 15).map((p) => (
                  <li key={p.key} className="flex justify-between gap-3 px-5 py-2">
                    <span>{p.label}</span>
                    <span>{p.orders} orders{p.revenue !== null ? ` · ${money(p.revenue)}` : ""}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tab.key === "operations" && ops && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel>
                <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">Orders in progress</h2>
                <ul className="divide-y divide-line text-[13px] tabular-nums">
                  {ops.by_stage.map((s) => (
                    <li key={s.stage} className="flex justify-between px-5 py-2"><span>{s.stage}</span><span>{s.orders}</span></li>
                  ))}
                </ul>
              </Panel>
              <Panel className="grid grid-cols-2 divide-line tabular-nums sm:divide-x">
                {[
                  { label: "Past delivery date", value: ops.overdue_deliveries },
                  { label: "Days to deliver (median, 90 days)", value: ops.median_days_to_deliver ?? "—" },
                  { label: "Appointments today", value: ops.appointments_today },
                ].map((k) => (
                  <div key={k.label} className="px-5 py-4">
                    <p className="text-[12.5px] text-muted">{k.label}</p>
                    <p className="mt-1 text-[22px] font-semibold">{k.value}</p>
                  </div>
                ))}
              </Panel>
            </div>
          )}

          <details className="mt-6 text-[12.5px] text-muted print:hidden">
            <summary className="cursor-pointer select-none">How these numbers are defined</summary>
            <dl className="mt-2 grid gap-1 sm:grid-cols-[180px_1fr]">
              {Object.entries(METRICS).map(([k, m]) => (
                <div key={k} className="contents"><dt className="font-medium text-text">{m.label}</dt><dd>{m.definition}</dd></div>
              ))}
            </dl>
          </details>
        </>
      )}
    </>
  );
}
