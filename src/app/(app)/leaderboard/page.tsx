import Link from "next/link";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { formatMetric } from "@/modules/analytics/metrics";
import { PRESETS, resolvePeriod } from "@/modules/analytics/period";
import { getLeaderboard } from "@/modules/branch-reporting/queries";
import { localDateKey } from "@/modules/tasks/schedule";
import { getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Leaderboard" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const PRESET_LABEL: Record<string, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", month: "This month", last_month: "Last month" };

export default async function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  const ctx = await getContext();
  const sp = await searchParams;
  const period = resolvePeriod({ preset: one(sp.preset) || "month" }, localDateKey(new Date(), ctx.business.timezone));
  const rows = await getLeaderboard(ctx.business.businessId, period.from, period.to);
  const money = (v: string) => formatMetric(v, "money", ctx.business.currency);

  return (
    <>
      <PageHeader title="Leaderboard" description={`${period.label}: conversions closed, order value and payments collected, per person.`} />
      {rows === null ? (
        <Panel><EmptyState title="The leaderboard is off">A business admin can switch it on in Settings.</EmptyState></Panel>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <Link key={p} href={`/leaderboard?preset=${p}`} className="rounded-full border border-line px-2.5 py-1 text-[12.5px] text-muted hover:text-text">{PRESET_LABEL[p]}</Link>
            ))}
          </div>
          <Panel>
            {rows.length === 0 ? (
              <EmptyState title="Nothing closed yet in this period" />
            ) : (
              <table className="w-full text-[13.5px] tabular-nums">
                <thead className="text-left text-[12px] text-muted">
                  <tr><th className="w-12 px-5 py-2 font-medium">#</th><th className="px-2 py-2 font-medium">Name</th><th className="px-2 py-2 text-right font-medium">Converted</th>
                    <th className="px-2 py-2 text-right font-medium">Order value</th><th className="px-2 py-2 text-right font-medium">Collected</th><th className="px-5 py-2 text-right font-medium">Leads handled</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.user_id} className={r.user_id === ctx.user.id ? "bg-signal-soft" : undefined}>
                      <td className="px-5 py-2 font-semibold">{r.rank_conversions}</td>
                      <td className="px-2 py-2">{r.name}{r.branch_name && <span className="ml-1 text-[12px] text-muted">{r.branch_name}</span>}</td>
                      <td className="px-2 py-2 text-right font-medium">{r.conversions}</td>
                      <td className="px-2 py-2 text-right">{money(r.revenue)}</td>
                      <td className="px-2 py-2 text-right">{money(r.collections)}</td>
                      <td className="px-5 py-2 text-right">{r.leads_handled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
