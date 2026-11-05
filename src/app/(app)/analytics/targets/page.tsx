import Link from "next/link";
import { TargetList } from "@/components/crm/target-list";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, SubmitButton } from "@/components/ui/form";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { deleteTarget, saveTarget } from "@/modules/branch-reporting/actions";
import { getTargetProgress, reportBranches } from "@/modules/branch-reporting/queries";
import { TARGET_METRICS } from "@/modules/branch-reporting/targets";
import { localDateKey } from "@/modules/tasks/schedule";
import { listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Targets" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function TargetsPage({ searchParams }: PageProps<"/analytics/targets">) {
  const ctx = await getContext();
  const biz = ctx.business.businessId;
  const manage = can(ctx, "targets.manage");
  const sp = await searchParams;
  const today = localDateKey(new Date(), ctx.business.timezone);
  const on = /^\d{4}-\d{2}$/.test(one(sp.month)) ? `${one(sp.month)}-01` : today;
  const [targets, branches, members] = await Promise.all([
    getTargetProgress(biz, { on }),
    manage ? reportBranches(biz) : Promise.resolve([]),
    manage ? listMembers(biz) : Promise.resolve([]),
  ]);
  const month = on.slice(0, 7);

  return (
    <>
      <Link href="/analytics/branches" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Branches</Link>
      <PageHeader
        title="Targets"
        description="Monthly and quarterly targets for the business, each branch and each person. The marker on each bar is where you'd be if the period went evenly."
      />
      <form className="mb-4 flex items-end gap-2">
        <label className="text-[13px]">
          <span className="mb-1 block text-[12.5px] font-medium">Month</span>
          <input type="month" name="month" defaultValue={month} className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2" />
        </label>
        <button type="submit" className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] font-medium">Show</button>
      </form>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Panel>
          <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">Progress</h2>
          {targets.length === 0 ? (
            <EmptyState title="No targets for this period">{manage ? "Set one on the right." : "Your manager hasn't set any yet."}</EmptyState>
          ) : (
            <>
              <TargetList targets={targets} currency={ctx.business.currency} />
              {manage && (
                <ul className="flex flex-wrap gap-2 border-t border-line px-5 py-3 text-[12.5px]">
                  {targets.map((t) => (
                    <li key={t.id}>
                      <ActionForm action={deleteTarget}>
                        <input type="hidden" name="id" value={t.id} />
                        <SubmitButton variant="ghost" className="h-7 px-2 text-[12px]">
                          Remove {t.person_name ?? t.branch_name ?? "business"} · {TARGET_METRICS[t.metric].label.toLowerCase()}
                        </SubmitButton>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>

        {manage && (
          <Panel className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Set a target</h2>
            <ActionForm action={saveTarget} className="flex flex-col gap-3">
              <SelectField label="For" name="scope" options={[{ value: "branch", label: "A branch" }, { value: "person", label: "A person" }, { value: "business", label: "The whole business" }]} />
              <SelectField label="Branch (for a branch target)" name="branchId" options={[{ value: "", label: "—" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
              <SelectField label="Person (for a person target)" name="userId" options={[{ value: "", label: "—" }, ...members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name }))]} />
              <SelectField label="Measure" name="metric" options={Object.entries(TARGET_METRICS).map(([value, m]) => ({ value, label: m.label }))} />
              <div className="grid grid-cols-2 gap-2">
                <SelectField label="Period" name="periodType" options={[{ value: "month", label: "Month" }, { value: "quarter", label: "Quarter" }]} />
                <Field label="Starting" name="month" type="month" defaultValue={month} required />
              </div>
              <Field label="Target" name="target" type="number" min={1} step="any" required />
              <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-muted">
                {Object.values(TARGET_METRICS).map((m) => <li key={m.label}><strong className="font-medium">{m.label}:</strong> {m.definition}</li>)}
              </ul>
              <div><SubmitButton>Save target</SubmitButton></div>
            </ActionForm>
          </Panel>
        )}
      </div>
    </>
  );
}
