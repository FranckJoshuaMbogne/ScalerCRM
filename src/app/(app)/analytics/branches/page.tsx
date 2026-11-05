import Link from "next/link";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { formatMetric } from "@/modules/analytics/metrics";
import { PRESETS, resolvePeriod } from "@/modules/analytics/period";
import { getBranchComparison, getTeamPerformance, getTransferReport } from "@/modules/branch-reporting/queries";
import { localDateKey } from "@/modules/tasks/schedule";
import { can, getContext } from "@/modules/tenancy/session";
import { PrintButton } from "../print-button";

export const metadata = { title: "Branches" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const PRESET_LABEL: Record<string, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", month: "This month", last_month: "Last month" };

export default async function BranchesPage({ searchParams }: PageProps<"/analytics/branches">) {
  const ctx = await getContext();
  if (!can(ctx, "analytics.view")) return <NoAccess what="branch reports" />;
  const sp = await searchParams;
  const period = resolvePeriod({ preset: one(sp.preset) || "90d", from: one(sp.from), to: one(sp.to) }, localDateKey(new Date(), ctx.business.timezone));
  const biz = ctx.business.businessId;
  const cur = ctx.business.currency;
  const [rows, transfers] = await Promise.all([getBranchComparison(biz, period.from, period.to), getTransferReport(biz, period.from, period.to)]);
  const branchId = one(sp.branch) || rows.find((r) => r.branch_id)?.branch_id || "";
  const team = branchId ? await getTeamPerformance(biz, branchId, period.from, period.to) : null;
  const money = (v: string | null) => (v === null ? "—" : formatMetric(v, "money", cur));
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  const totals = rows.reduce(
    (t, r) => ({ leads: t.leads + Number(r.leads), won: t.won + Number(r.won), orders: t.orders + Number(r.orders), revenue: t.revenue + Number(r.revenue ?? 0), collected: t.collected + Number(r.collected ?? 0) }),
    { leads: 0, won: 0, orders: 0, revenue: 0, collected: 0 },
  );
  const showMoney = rows.some((r) => r.revenue !== null);
  const q = (extra: Record<string, string>) => `/analytics/branches?${new URLSearchParams({ from: period.from, to: period.to, ...extra })}`;

  return (
    <>
      <Link href="/analytics" className="mb-3 inline-block text-[13.5px] text-signal hover:underline print:hidden">Analytics</Link>
      <PageHeader
        title="Branches"
        description={`${period.label} (${period.from} to ${period.to}). The same definitions as the dashboards; branch figures add up to the business.`}
        actions={
          <>
            <Link href="/analytics/targets" className={linkButton.secondary}>Targets</Link>
            <PrintButton>PDF</PrintButton>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2 print:hidden">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <Link key={p} href={`/analytics/branches?preset=${p}`} className="rounded-full border border-line px-2.5 py-1 text-[12.5px] text-muted hover:text-text">{PRESET_LABEL[p]}</Link>
          ))}
        </div>
        <form className="ml-auto flex items-end gap-1.5">
          <input type="date" name="from" defaultValue={period.from} aria-label="From" className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13px]" />
          <input type="date" name="to" defaultValue={period.to} aria-label="To" className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13px]" />
          <button type="submit" className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] font-medium">Apply</button>
        </form>
      </div>

      <Panel className="mb-6">
        <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">
          Side by side
          <span className="block text-[12.5px] font-normal text-muted">
            Conversion counts leads created in the period that are won by now. The index compares each branch&apos;s conversions with what the business converts on leads from the same sources (1.00 = as expected), so a branch with mostly walk-ins isn&apos;t flattered.
          </span>
        </h2>
        {rows.length === 0 ? (
          <EmptyState title="No branch figures for this period" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[13px] tabular-nums">
              <thead className="text-left text-[12px] text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Branch</th>
                  <th className="px-2 py-2 text-right font-medium">Leads</th>
                  <th className="px-2 py-2 text-right font-medium">Won</th>
                  <th className="px-2 py-2 text-right font-medium">Rate</th>
                  <th className="px-2 py-2 text-right font-medium">Expected</th>
                  <th className="px-2 py-2 text-right font-medium">Index</th>
                  <th className="px-2 py-2 text-right font-medium">Days to win</th>
                  <th className="px-2 py-2 text-right font-medium">Orders</th>
                  {showMoney && <th className="px-2 py-2 text-right font-medium">Revenue</th>}
                  {showMoney && <th className="px-2 py-2 text-right font-medium">Avg order</th>}
                  {showMoney && <th className="px-2 py-2 text-right font-medium">Collected</th>}
                  {showMoney && <th className="px-2 py-2 text-right font-medium">Outstanding</th>}
                  <th className="px-2 py-2 text-right font-medium">Walk-ins</th>
                  <th className="px-2 py-2 text-right font-medium">Appts</th>
                  <th className="px-2 py-2 text-right font-medium">No-show</th>
                  <th className="px-5 py-2 text-right font-medium">Overdue tasks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.branch_id ?? "none"}>
                    <td className="px-5 py-2 font-medium">
                      {r.branch_id ? <Link href={q({ branch: r.branch_id })} className="hover:text-signal">{r.branch_name}</Link> : r.branch_name}
                    </td>
                    <td className="px-2 py-2 text-right">{r.leads}</td>
                    <td className="px-2 py-2 text-right">{r.won}</td>
                    <td className="px-2 py-2 text-right">{pct(r.conversion_rate)}</td>
                    <td className="px-2 py-2 text-right">{r.expected_won ?? "—"}</td>
                    <td className={cn("px-2 py-2 text-right font-medium", r.performance_index === null ? "" : Number(r.performance_index) >= 1 ? "text-stage-won" : "text-danger")}>{r.performance_index ?? "—"}</td>
                    <td className="px-2 py-2 text-right">{r.median_days_to_win ?? "—"}</td>
                    <td className="px-2 py-2 text-right">{r.orders}</td>
                    {showMoney && <td className="px-2 py-2 text-right">{money(r.revenue)}</td>}
                    {showMoney && <td className="px-2 py-2 text-right">{money(r.average_order_value)}</td>}
                    {showMoney && <td className="px-2 py-2 text-right">{money(r.collected)}</td>}
                    {showMoney && <td className="px-2 py-2 text-right">{money(r.outstanding)}</td>}
                    <td className="px-2 py-2 text-right">{r.walk_ins}</td>
                    <td className="px-2 py-2 text-right">{r.appointments}</td>
                    <td className="px-2 py-2 text-right">{pct(r.no_show_rate)}</td>
                    <td className="px-5 py-2 text-right">{r.tasks_overdue}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line font-medium">
                <tr>
                  <td className="px-5 py-2">Total</td>
                  <td className="px-2 py-2 text-right">{totals.leads}</td>
                  <td className="px-2 py-2 text-right">{totals.won}</td>
                  <td className="px-2 py-2 text-right">{totals.leads ? `${Math.round((1000 * totals.won) / totals.leads) / 10}%` : "—"}</td>
                  <td colSpan={3} />
                  <td className="px-2 py-2 text-right">{totals.orders}</td>
                  {showMoney && <td className="px-2 py-2 text-right">{money(String(totals.revenue))}</td>}
                  {showMoney && <td />}
                  {showMoney && <td className="px-2 py-2 text-right">{money(String(totals.collected))}</td>}
                  <td colSpan={showMoney ? 5 : 4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="mb-6">
        <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">
          Team: {rows.find((r) => r.branch_id === branchId)?.branch_name ?? "choose a branch"}
          <span className="block text-[12.5px] font-normal text-muted">Leads in this branch at least 7 days old, per salesperson, normalised against the business&apos;s source rates.</span>
        </h2>
        {!team || team.length === 0 ? (
          <EmptyState title={team ? "No leads for this branch in the period" : "Pick a branch above"} />
        ) : (
          <table className="w-full text-[13px] tabular-nums">
            <thead className="text-left text-[12px] text-muted">
              <tr><th className="px-5 py-2 font-medium">Salesperson</th><th className="px-2 py-2 text-right font-medium">Leads</th><th className="px-2 py-2 text-right font-medium">Won</th>
                <th className="px-2 py-2 text-right font-medium">Expected</th><th className="px-2 py-2 text-right font-medium">Index</th><th className="px-2 py-2 text-right font-medium">Days to win</th><th className="px-5 py-2 text-right font-medium">Overdue tasks</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {team.map((t) => (
                <tr key={t.owner_id ?? "none"}>
                  <td className="px-5 py-2">{t.owner_name}</td>
                  <td className="px-2 py-2 text-right">{t.leads}</td>
                  <td className="px-2 py-2 text-right">{t.won}</td>
                  <td className="px-2 py-2 text-right">{t.expected_won ?? "—"}</td>
                  <td className={cn("px-2 py-2 text-right font-medium", Number(t.performance_index) >= 1 ? "text-stage-won" : Number(t.performance_index) > 0 ? "text-danger" : "")}>{t.performance_index ?? "—"}</td>
                  <td className="px-2 py-2 text-right">{t.median_days_to_win ?? "—"}</td>
                  <td className="px-5 py-2 text-right">{t.open_overdue_tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel>
        <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">
          Lead transfers
          <span className="block text-[12.5px] font-normal text-muted">Leads moved between branches in the period: who sent them, who closed them and how long closing took.</span>
        </h2>
        {transfers.length === 0 ? (
          <EmptyState title="No leads moved between branches in this period" />
        ) : (
          <table className="w-full text-[13px] tabular-nums">
            <thead className="text-left text-[12px] text-muted">
              <tr><th className="px-5 py-2 font-medium">From → to</th><th className="px-2 py-2 text-right font-medium">Moved</th><th className="px-2 py-2 text-right font-medium">Won after</th>
                <th className="px-2 py-2 text-right font-medium">Days to close</th><th className="px-2 py-2 font-medium">Sent by</th><th className="px-5 py-2 font-medium">Closed by</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {transfers.map((t) => (
                <tr key={`${t.from_branch_id}-${t.to_branch_id}`}>
                  <td className="px-5 py-2">{t.from_branch} → {t.to_branch}</td>
                  <td className="px-2 py-2 text-right">{t.transfers}</td>
                  <td className="px-2 py-2 text-right">{t.won}</td>
                  <td className="px-2 py-2 text-right">{t.median_days_to_close ?? "—"}</td>
                  <td className="px-2 py-2">{t.senders ?? "—"}</td>
                  <td className="px-5 py-2">{t.closers ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
