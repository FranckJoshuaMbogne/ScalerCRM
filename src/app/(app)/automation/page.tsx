import Link from "next/link";
import { Plus } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addScoringRule, removeScoringRule, retryRuns, setAutomationActive } from "@/modules/automation/actions";
import { describeAction, TRIGGERS } from "@/modules/automation/definitions";
import { listAutomations, listRuns, listScoringRules } from "@/modules/automation/queries";
import { listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Automation" };

const FIELDS = [
  { value: "source_key", label: "Lead source is (key)" },
  { value: "stage", label: "Stage colour is (new/contacted/qualified/negotiation)" },
  { value: "expected_value_gte", label: "Expected value at least" },
  { value: "has_email", label: "Gave an email" },
  { value: "has_appointment", label: "Has an appointment" },
  { value: "activity_count_gte", label: "Logged activities at least" },
  { value: "active_within_days", label: "Active within (days)" },
];

const STATUS_STYLE: Record<string, string> = { done: "bg-stage-won/15", failed: "bg-danger/10 text-danger", waiting: "bg-stage-negotiation/15", skipped: "bg-line" };

export default async function AutomationPage({ searchParams }: PageProps<"/automation">) {
  const ctx = await getContext();
  if (!can(ctx, "automation.manage")) return <NoAccess what="automation" />;
  const sp = await searchParams;
  const biz = ctx.business.businessId;
  const [automations, runs, rules, members] = await Promise.all([listAutomations(biz), listRuns(biz), listScoringRules(biz), listMembers(biz)]);
  const person = new Map(members.map((m) => [m.userId, m.name]));
  const names = { person: (id: string) => person.get(id) };
  const automationName = new Map(automations.map((a) => [a.id, a.name]));
  const failed = runs.filter((r) => r.status === "failed").length;

  return (
    <>
      <PageHeader
        title="Automation"
        description="SCALER acts on events: tasks, notifications, assignment and WhatsApp follow-ups. Every run is logged."
        actions={<Link href="/automation/new" className={linkButton.primary}><Plus className="size-4" /> New automation</Link>}
      />
      {sp.saved && <p role="status" className="mb-4 rounded-[var(--radius-control)] bg-signal-soft px-3 py-2 text-[13.5px]">Saved. Switch it on when you&apos;re ready.</p>}

      <Panel className="mb-6">
        <ul className="divide-y divide-line">
          {automations.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3.5 text-[13.5px]">
              <div className="min-w-0 flex-1">
                <Link href={`/automation/${a.id}`} className="font-medium hover:text-signal">{a.name}</Link>
                <p className="text-[12.5px] text-muted">
                  When {TRIGGERS[a.trigger as keyof typeof TRIGGERS]?.toLowerCase() ?? a.trigger}
                  {a.trigger === "lead_idle" ? ` (${String(a.triggerConfig.days)} days)` : ""}
                  {a.triggerConfig.status_key ? ` (${String(a.triggerConfig.status_key).replace(/_/g, " ")})` : ""}
                  {a.triggerConfig.stage_key ? ` (${String(a.triggerConfig.stage_key).replace(/_/g, " ")})` : ""}
                  {a.conditions.length ? `, if ${a.conditions.length} condition${a.conditions.length === 1 ? "" : "s"} match` : ""}:{" "}
                  {a.actions.map((x) => describeAction(x, names)).join(", then ")}.
                </p>
              </div>
              <ActionForm action={setAutomationActive}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="active" value={String(!a.isActive)} />
                <SubmitButton variant={a.isActive ? "secondary" : "primary"} className="h-8 px-3 text-[13px]">{a.isActive ? "On · turn off" : "Turn on"}</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="text-[15px] font-semibold">Recent runs</h2>
            {failed > 0 && <ActionForm action={retryRuns}><SubmitButton variant="secondary" className="h-8 text-[13px]">Retry {failed} failed</SubmitButton></ActionForm>}
          </div>
          {runs.length === 0 ? (
            <EmptyState title="Nothing has run yet" />
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {runs.map((r) => (
                <li key={r.id} className="px-5 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-medium", STATUS_STYLE[r.status] ?? "bg-line")}>{r.status}</span>
                    <span className="font-medium">{automationName.get(r.automationId)}</span>
                    <Link href={r.entityType === "lead" ? `/leads/${r.entityId}` : r.entityType === "order" ? `/orders/${r.entityId}` : "/appointments"} className="text-muted hover:text-signal">
                      {r.entityType}
                    </Link>
                    <span className="ml-auto text-[12px] text-muted tabular-nums">{formatDateTime(r.createdAt, ctx.business.timezone)}</span>
                  </div>
                  {r.error && <p className="mt-0.5 text-[12.5px] text-danger">{r.error}</p>}
                  {r.log.some((l) => l.reason) && <p className="mt-0.5 text-[12.5px] text-muted">{r.log.find((l) => l.reason)?.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">
            Lead scoring
            <span className="block text-[12.5px] font-normal text-muted">Points add up to each lead&apos;s score, shown on lists and the board. Hottest leads first.</span>
          </h2>
          <ul className="divide-y divide-line text-[13px]">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-5 py-2">
                <span className={cn("w-12 text-right font-medium tabular-nums", r.points < 0 ? "text-danger" : "")}>{r.points > 0 ? "+" : ""}{r.points}</span>
                <span className="flex-1">{r.label}</span>
                <ActionForm action={removeScoringRule}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton variant="ghost">Remove</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
          <ActionForm action={addScoringRule} className="grid gap-2 border-t border-line p-5">
            <Field label="Label" name="label" placeholder="Came from Google ads" required />
            <SelectField label="When" name="field" options={FIELDS} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Value" name="value" placeholder="google_ads" />
              <Field label="Points" name="points" type="number" min={-100} max={100} defaultValue="10" required />
            </div>
            <div><SubmitButton variant="secondary">Add rule</SubmitButton></div>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
