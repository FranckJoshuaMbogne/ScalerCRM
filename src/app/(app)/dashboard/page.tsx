import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { listStatuses } from "@/modules/leads/config";
import { countUnassignedLeads } from "@/modules/leads/queries";
import { countMyTasks } from "@/modules/tasks/queries";
import { formatMetric, METRICS, type MetricKey } from "@/modules/analytics/metrics";
import { resolvePeriod } from "@/modules/analytics/period";
import { getBreakdown, getSummary } from "@/modules/analytics/queries";
import { localDateKey } from "@/modules/tasks/schedule";
import { can, getContext } from "@/modules/tenancy/session";
import { linkButton, PageHeader, Panel } from "@/components/ui/primitives";

export const metadata = { title: "Dashboard" };

const setup = [
  { title: "Set up your business and first branch", href: "/settings", sprint: 1 },
  { title: "Invite your team and give each person a role", href: "/team", sprint: 1 },
  { title: "Add your first lead or walk-in", href: "/leads", sprint: 2 },
  { title: "Shape your pipeline and turn on round-robin assignment", href: "/settings/pipeline", sprint: 3 },
  { title: "Add your products and services, and record the first order", href: "/settings/orders", sprint: 4 },
  { title: "Turn on the automations you want", href: "/automation", sprint: 8 },
  { title: "Connect WhatsApp", href: "/integrations", sprint: 5 },
  { title: "Connect Meta and Google lead forms", href: "/integrations", sprint: 7 },
];

async function Today() {
  const ctx = await getContext();
  const id = ctx.business.businessId;
  const showQueue = can(ctx, "leads.view_all");
  const [tasks, unassigned] = await Promise.all([
    can(ctx, "tasks.manage") ? countMyTasks(id, ctx.user.id, ctx.business.timezone) : Promise.resolve(null),
    showQueue
      ? listStatuses(id).then((s) => countUnassignedLeads(id, s.filter((x) => x.category === "open").map((x) => x.id)))
      : Promise.resolve(null),
  ]);
  const tiles = [
    ...(tasks
      ? [
          { label: "Overdue follow-ups", value: tasks.overdue, href: "/tasks", alert: tasks.overdue > 0 },
          { label: "Due today", value: tasks.today, href: "/tasks", alert: false },
        ]
      : []),
    ...(unassigned !== null
      ? [{ label: "Unassigned leads", value: unassigned, href: "/leads/queue", alert: unassigned > 0 }]
      : []),
  ];
  if (!tiles.length) return null;
  return (
    <Panel className="mb-6 grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {tiles.map((t) => (
        <Link key={t.label} href={t.href} className="px-5 py-4 hover:bg-paper/60">
          <p className="text-[13px] text-muted">{t.label}</p>
          <p className={`mt-1 text-[26px] font-semibold tracking-tight tabular-nums ${t.alert ? "text-danger" : ""}`}>{t.value}</p>
        </Link>
      ))}
    </Panel>
  );
}

const KPIS: MetricKey[] = ["leads", "conversion_rate", "walk_ins", "orders", "collected", "outstanding"];

/** Same definitions as Analytics (src/modules/analytics/metrics.ts), last 30 days. */
async function Kpis() {
  const ctx = await getContext();
  if (!can(ctx, "dashboard.view")) return null;
  const period = resolvePeriod({ preset: "30d" }, localDateKey(new Date(), ctx.business.timezone));
  const summary = await getSummary(ctx.business.businessId, period.from, period.to);
  if (!summary) return null;
  const keys = KPIS.filter((k) => summary[k] !== null && summary[k] !== undefined);
  return (
    <Panel className="mb-6 grid grid-cols-2 tabular-nums divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
      {keys.map((k) => (
        <div key={k} className="px-5 py-4" title={METRICS[k].definition}>
          <p className="text-[13px] text-muted">{METRICS[k].label}</p>
          <p className="mt-1 text-[24px] font-semibold tracking-tight">{formatMetric(summary[k], METRICS[k].format, ctx.business.currency)}</p>
          <p className="text-[12px] text-muted">{k === "outstanding" ? "Open orders" : "Last 30 days"}</p>
        </div>
      ))}
    </Panel>
  );
}

async function Breakdowns() {
  const ctx = await getContext();
  if (!can(ctx, "analytics.view")) return null;
  const period = resolvePeriod({ preset: "30d" }, localDateKey(new Date(), ctx.business.timezone));
  const [sources, stages] = await Promise.all([
    getBreakdown(ctx.business.businessId, period.from, period.to, "source"),
    getBreakdown(ctx.business.businessId, period.from, period.to, "stage"),
  ]);
  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Panel>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Leads by channel</h2>
          <Link href="/analytics?tab=marketing" className="text-[12.5px] text-signal hover:underline">Last 30 days</Link>
        </div>
        <table className="w-full text-[13.5px] tabular-nums">
          <thead className="text-left text-[12.5px] text-muted">
            <tr><th className="px-5 py-2.5 font-medium">Channel</th><th className="px-5 py-2.5 text-right font-medium">Leads</th>
              <th className="px-5 py-2.5 text-right font-medium">Orders</th><th className="px-5 py-2.5 text-right font-medium">Conversion</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sources.length === 0 && <tr><td colSpan={4} className="px-5 py-4 text-muted">No leads in the last 30 days.</td></tr>}
            {sources.map((c) => (
              <tr key={c.key}>
                <td className="px-5 py-2.5">{c.label}</td>
                <td className="px-5 py-2.5 text-right">{c.leads}</td>
                <td className="px-5 py-2.5 text-right">{c.orders}</td>
                <td className="px-5 py-2.5 text-right text-muted">{c.conversion_rate === null ? "–" : `${c.conversion_rate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel>
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Where new leads are now</h2>
        </div>
        <ul className="divide-y divide-line tabular-nums">
          {stages.map((p) => (
            <li key={p.key} className="flex items-center gap-3 px-5 py-2.5 text-[13.5px]">
              <span className="flex-1">{p.label}</span>
              <span className="font-medium">{p.leads}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="How enquiries are turning into orders across every channel."
        actions={
          <Link href="/leads/new" className={linkButton.primary}>
            <Plus className="size-4" /> Add lead
          </Link>
        }
      />

      <Suspense fallback={null}>
        <Today />
      </Suspense>

      <Suspense fallback={<Panel className="mb-6 h-[104px]" />}>
        <Kpis />
      </Suspense>

      <Suspense fallback={null}>
        <Breakdowns />
      </Suspense>

      <Panel className="mt-6">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Get SCALER ready</h2>
          <p className="text-[13px] text-muted">
            Steps unlock as each sprint ships.
          </p>
        </div>
        <ol className="divide-y divide-line">
          {setup.map((s, i) => (
            <li key={s.title} className="flex items-center gap-4 px-5 py-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line text-[12.5px] font-medium text-muted">
                {i + 1}
              </span>
              <Link href={s.href} className="flex-1 text-[14px] hover:text-signal">
                {s.title}
              </Link>
              <span className="text-[12px] text-muted">Sprint {s.sprint}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}
