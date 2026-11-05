import Link from "next/link";
import { Download } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { removeSchedule, scheduleReport } from "@/modules/analytics/actions";
import { listReportSchedules } from "@/modules/analytics/queries";
import { reportBranches } from "@/modules/branch-reporting/queries";
import { emailConfigured } from "@/modules/email/send";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Reports" };

const REPORTS = [
  { value: "executive", label: "Executive summary" },
  { value: "marketing", label: "Marketing" },
  { value: "sales", label: "Sales" },
  { value: "operations", label: "Operations" },
  { value: "pack_owner", label: "Owner pack (all branches, CSV attached)" },
  { value: "pack_branch", label: "Branch manager pack (one branch, CSV attached)" },
  { value: "pack_marketing", label: "Marketing pack (sources and campaigns, CSV attached)" },
];

export default async function ReportsPage() {
  const ctx = await getContext();
  if (!can(ctx, "analytics.view") && !can(ctx, "reports.export")) return <NoAccess what="reports" />;
  const [schedules, branches] = await Promise.all([listReportSchedules(ctx.business.businessId), reportBranches(ctx.business.businessId)]);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const exports = [
    { href: "/api/export/leads", label: "All leads", note: "Stage, source, campaign, owner, score", show: can(ctx, "leads.export") },
    { href: "/api/export/customers", label: "Customer files", note: "CIF, contact details", show: can(ctx, "customers.export") },
    { href: "/api/export/orders", label: "Orders", note: "Totals, paid and balance", show: can(ctx, "reports.export") },
  ].filter((e) => e.show);

  return (
    <>
      <PageHeader title="Reports" description="Downloads and reports emailed on a schedule. Dashboards are under Analytics; use its PDF button for a printable copy." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Download CSV</h2>
          {exports.length === 0 ? (
            <EmptyState title="Your role has no exports" />
          ) : (
            <ul className="divide-y divide-line">
              {exports.map((e) => (
                <li key={e.href} className="flex items-center justify-between gap-3 px-5 py-3 text-[13.5px]">
                  <div><p className="font-medium">{e.label}</p><p className="text-[12.5px] text-muted">{e.note}</p></div>
                  <a href={e.href} className="inline-flex items-center gap-1.5 text-signal hover:underline"><Download className="size-4" /> CSV</a>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line px-5 py-3 text-[12.5px] text-muted">Exports contain only what you can see, up to 10,000 rows, and are recorded in the audit log.</p>
        </Panel>

        {can(ctx, "analytics.view") && (
          <Panel>
            <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Emailed to me</h2>
            {!emailConfigured() && <p className="px-5 pt-3 text-[12.5px] text-danger">Email isn&apos;t configured on this server yet, so scheduled reports won&apos;t be sent.</p>}
            <ul className="divide-y divide-line">
              {schedules.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 px-5 py-2.5 text-[13.5px]">
                  <span className="font-medium">
                    {REPORTS.find((r) => r.value === s.report)?.label.replace(/ \(.*\)$/, "")}
                    {s.branch_id ? ` · ${branchName.get(s.branch_id) ?? "branch"}` : ""}
                  </span>
                  <span className="text-muted">{s.frequency}</span>
                  <span className="text-[12.5px] text-muted">next {formatDateTime(s.next_run_at, ctx.business.timezone)}</span>
                  <ActionForm action={removeSchedule} className="ml-auto">
                    <input type="hidden" name="id" value={s.id} />
                    <SubmitButton variant="ghost">Stop</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
            <ActionForm action={scheduleReport} className="flex flex-wrap items-end gap-2 border-t border-line p-5">
              <SelectField label="Report" name="report" options={REPORTS} />
              <SelectField label="How often" name="frequency" options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly (Mondays)" }, { value: "monthly", label: "Monthly (1st)" }]} />
              <SelectField label="Branch (branch pack)" name="branchId" options={[{ value: "", label: "—" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
              <SubmitButton variant="secondary">Email it to me</SubmitButton>
            </ActionForm>
          </Panel>
        )}
      </div>
      <p className="mt-6 flex flex-wrap gap-4 text-[13px]">
        <Link href="/analytics" className="text-signal hover:underline">Open the dashboards</Link>
        {can(ctx, "analytics.view") && <Link href="/analytics/pack?kind=pack_owner" className="text-signal hover:underline">See a pack now (printable)</Link>}
      </p>
    </>
  );
}
