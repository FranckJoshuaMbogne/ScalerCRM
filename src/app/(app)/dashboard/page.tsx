import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { listStatuses } from "@/modules/leads/config";
import { countUnassignedLeads } from "@/modules/leads/queries";
import { countMyTasks } from "@/modules/tasks/queries";
import { can, getContext } from "@/modules/tenancy/session";
import {
  linkButton,
  PageHeader,
  Panel,
  type Stage,
  StageDot,
} from "@/components/ui/primitives";

export const metadata = { title: "Dashboard" };

/* Sprint 0: layout only. Figures are wired to analytics in Sprint 8. */
const kpis = [
  { label: "New leads", value: "0", note: "Last 30 days" },
  { label: "Walk-ins", value: "0", note: "Last 30 days" },
  { label: "Orders confirmed", value: "0", note: "Last 30 days" },
  { label: "Revenue", value: "₹0", note: "Net, last 30 days" },
  { label: "Outstanding", value: "₹0", note: "All open orders" },
];

const pipeline: { label: string; stage: Stage; count: number }[] = [
  { label: "New", stage: "new", count: 0 },
  { label: "Contacted", stage: "contacted", count: 0 },
  { label: "Qualified", stage: "qualified", count: 0 },
  { label: "Negotiation", stage: "negotiation", count: 0 },
  { label: "Converted", stage: "won", count: 0 },
  { label: "Lost", stage: "lost", count: 0 },
];

const channels = ["Meta Ads", "Google Ads", "WhatsApp", "Website", "Walk-ins", "Referrals"];

const setup = [
  { title: "Set up your business and first branch", href: "/settings", sprint: 1 },
  { title: "Invite your team and give each person a role", href: "/team", sprint: 1 },
  { title: "Add your first lead or walk-in", href: "/leads", sprint: 2 },
  { title: "Shape your pipeline and turn on round-robin assignment", href: "/settings/pipeline", sprint: 3 },
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

      <Panel className="mb-6 grid grid-cols-2 tabular-nums divide-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="px-5 py-4">
            <p className="text-[13px] text-muted">{kpi.label}</p>
            <p className="mt-1 text-[26px] font-semibold tracking-tight">{kpi.value}</p>
            <p className="text-[12px] text-muted">{kpi.note}</p>
          </div>
        ))}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">Leads by channel</h2>
            <span className="text-[12.5px] text-muted">Last 30 days</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px] tabular-nums">
              <thead className="text-left text-[12.5px] text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Channel</th>
                  <th className="px-5 py-2.5 text-right font-medium">Leads</th>
                  <th className="px-5 py-2.5 text-right font-medium">Orders</th>
                  <th className="px-5 py-2.5 text-right font-medium">Conversion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {channels.map((c) => (
                  <tr key={c}>
                    <td className="px-5 py-2.5">{c}</td>
                    <td className="px-5 py-2.5 text-right">0</td>
                    <td className="px-5 py-2.5 text-right">0</td>
                    <td className="px-5 py-2.5 text-right text-muted">–</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">Pipeline</h2>
          </div>
          <ul className="divide-y divide-line tabular-nums">
            {pipeline.map((p) => (
              <li key={p.label} className="flex items-center gap-3 px-5 py-2.5 text-[13.5px]">
                <StageDot stage={p.stage} />
                <span className="flex-1">{p.label}</span>
                <span className="font-medium">{p.count}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

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
