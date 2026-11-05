import Link from "next/link";
import { FollowUpForm } from "@/components/crm/follow-up-form";
import { TaskList } from "@/components/crm/task-list";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { TASK_TYPE_LABELS } from "@/modules/leads/timeline";
import { listMyDay } from "@/modules/tasks/queries";
import { bucketFor, followUpPresets, toLocalInput } from "@/modules/tasks/schedule";
import { listMembers } from "@/modules/team/queries";
import { TargetList } from "@/components/crm/target-list";
import { getTargetProgress } from "@/modules/branch-reporting/queries";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "My day" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECTIONS = [
  { key: "overdue", title: "Overdue", empty: "Nothing overdue." },
  { key: "today", title: "Today", empty: "Nothing else due today." },
  { key: "upcoming", title: "Next 7 days", empty: "Nothing planned for the coming week." },
] as const;

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const ctx = await getContext();
  const canManage = can(ctx, "tasks.manage");
  const canTeam = can(ctx, "tasks.view_all");
  if (!canManage && !canTeam) return <NoAccess what="tasks" />;

  const sp = await searchParams;
  const raw = one(sp.who);
  const who = canTeam && (raw === "team" || UUID.test(raw)) ? raw : "me";
  const tz = ctx.business.timezone;
  const now = new Date();

  const [{ open, done }, members, myTargets] = await Promise.all([
    listMyDay(ctx.business.businessId, { who, userId: ctx.user.id }, tz, now),
    listMembers(ctx.business.businessId),
    getTargetProgress(ctx.business.businessId, { mineOnly: true }),
  ]);
  const people = new Map(members.map((m) => [m.userId, m.name]));
  const active = members.filter((m) => m.status === "active");
  const assignees = canTeam ? active.map((m) => ({ value: m.userId, label: m.name })) : undefined;
  const presets = followUpPresets(now, tz).map(({ key, label }) => ({ key, label }));
  const grouped = Object.groupBy(open, (t) => bucketFor(new Date(t.dueAt), now, tz));
  const showAssignee = who !== "me" && who !== ctx.user.id;

  const tabs = [
    { value: "me", label: "Mine" },
    ...(canTeam ? [{ value: "team", label: "Everyone" }] : []),
  ];

  return (
    <>
      <PageHeader
        title="My day"
        description={
          showAssignee
            ? "Follow-ups across your team. Overdue ones are also flagged to each person."
            : "Your follow-ups: overdue first, then today and the week ahead."
        }
      />

      {who === "me" && myTargets.length > 0 && (
        <Panel className="mb-4">
          <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">My targets</h2>
          <TargetList targets={myTargets} currency={ctx.business.currency} showWho={false} />
        </Panel>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Whose tasks" className="flex gap-1">
          {tabs.map((t) => (
            <Link
              key={t.value}
              href={`/tasks?who=${t.value}`}
              aria-current={who === t.value ? "page" : undefined}
              className="rounded-full px-3 py-1.5 text-[13px] text-muted hover:bg-surface aria-[current=page]:bg-surface aria-[current=page]:font-medium aria-[current=page]:text-text aria-[current=page]:shadow-sm"
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {canTeam && (
          <form className="flex items-center gap-2">
            <label htmlFor="who" className="sr-only">Person</label>
            <select
              id="who"
              name="who"
              defaultValue={UUID.test(who) ? who : ""}
              className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[13.5px]"
            >
              <option value="" disabled>One person…</option>
              {active.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name}</option>
              ))}
            </select>
            <button type="submit" className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-paper">
              Show
            </button>
          </form>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {SECTIONS.map((s) => {
            const tasks = grouped[s.key] ?? [];
            return (
              <Panel key={s.key}>
                <h2 className="flex items-center justify-between border-b border-line px-5 py-3.5 text-[15px] font-semibold">
                  <span className={s.key === "overdue" && tasks.length ? "text-danger" : undefined}>{s.title}</span>
                  <span className="text-[13px] font-normal text-muted tabular-nums">{tasks.length}</span>
                </h2>
                {tasks.length ? (
                  <TaskList
                    tasks={tasks}
                    now={now}
                    timeZone={tz}
                    presets={presets}
                    people={people}
                    assignees={assignees}
                    showAssignee={showAssignee}
                    canManage={canManage}
                  />
                ) : (
                  <p className="px-5 py-4 text-[13.5px] text-muted">{s.empty}</p>
                )}
              </Panel>
            );
          })}

          <Panel>
            <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Done today</h2>
            {done.length ? (
              <ul className="divide-y divide-line">
                {done.map((t) => (
                  <li key={t.id} className="px-5 py-3 text-[13.5px]">
                    <p>
                      <span className="text-muted capitalize">{TASK_TYPE_LABELS[t.type] ?? t.type}:</span>{" "}
                      <span className="line-through decoration-muted/60">{t.title}</span>
                      {t.lead && (
                        <Link href={`/leads/${t.lead.id}`} className="ml-1 text-muted hover:text-signal">
                          {t.lead.leadNumber}
                        </Link>
                      )}
                    </p>
                    {t.outcome && <p className="mt-0.5 text-[12.5px] text-muted">{t.outcome}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing finished yet today" />
            )}
          </Panel>
        </div>

        {canManage && (
          <Panel className="h-fit p-5">
            <h2 className="mb-1 text-[15px] font-semibold">Add a task</h2>
            <p className="mb-4 text-[13px] text-muted">For follow-ups on a lead, add them from the lead so they show on its timeline.</p>
            <FollowUpForm
              presets={presets}
              assignees={assignees}
              defaultAssignee={ctx.user.id}
              minDate={toLocalInput(now, tz)}
              idPrefix="mytask"
            />
          </Panel>
        )}
      </div>
    </>
  );
}
