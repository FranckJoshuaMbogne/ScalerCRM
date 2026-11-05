import Link from "next/link";
import { Download } from "lucide-react";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { formatMetric, METRICS, type MetricKey } from "@/modules/analytics/metrics";
import { resolvePeriod } from "@/modules/analytics/period";
import { PACKS, type PackKind, packSections } from "@/modules/branch-reporting/pack";
import { getPack, reportBranches } from "@/modules/branch-reporting/queries";
import { localDateKey } from "@/modules/tasks/schedule";
import { can, getContext } from "@/modules/tenancy/session";
import { PrintButton } from "../print-button";

export const metadata = { title: "Report pack" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const SUMMARY: MetricKey[] = ["leads", "leads_won", "conversion_rate", "orders", "revenue", "collected", "outstanding", "walk_ins", "appointments", "no_show_rate", "tasks_overdue"];

/** A report pack on screen: print it as the PDF, or download each table as CSV. */
export default async function PackPage({ searchParams }: PageProps<"/analytics/pack">) {
  const ctx = await getContext();
  if (!can(ctx, "analytics.view")) return <NoAccess what="report packs" />;
  const sp = await searchParams;
  const kind = (one(sp.kind) in PACKS ? one(sp.kind) : "pack_owner") as PackKind;
  const period = resolvePeriod({ preset: one(sp.preset) || "7d", from: one(sp.from), to: one(sp.to) }, localDateKey(new Date(), ctx.business.timezone));
  const branches = await reportBranches(ctx.business.businessId);
  const branch = kind === "pack_branch" ? one(sp.branch) || branches[0]?.id || null : null;
  const pack = await getPack(ctx.business.businessId, kind, branch, period.from, period.to);
  const query = (extra: Record<string, string>) => new URLSearchParams({ pack: kind, from: period.from, to: period.to, ...(branch ? { branch } : {}), ...extra }).toString();

  return (
    <>
      <Link href="/reports" className="mb-3 inline-block text-[13.5px] text-signal hover:underline print:hidden">Reports</Link>
      <PageHeader
        title={`${PACKS[kind].label}${branch ? ` · ${branches.find((b) => b.id === branch)?.name ?? ""}` : ""}`}
        description={`${ctx.business.businessName}, ${period.from} to ${period.to}. ${PACKS[kind].description}`}
        actions={<PrintButton>PDF</PrintButton>}
      />
      <form className="mb-4 flex flex-wrap items-end gap-2 text-[13px] print:hidden">
        <select name="kind" defaultValue={kind} aria-label="Pack" className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2">
          {Object.entries(PACKS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
        <select name="branch" defaultValue={branch ?? ""} aria-label="Branch" className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2">
          <option value="">Branch (branch pack)</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input type="date" name="from" defaultValue={period.from} aria-label="From" className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2" />
        <input type="date" name="to" defaultValue={period.to} aria-label="To" className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2" />
        <button type="submit" className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 font-medium">Show</button>
      </form>

      {!pack ? (
        <Panel><EmptyState title="This pack isn't available to you" /></Panel>
      ) : (
        <>
          <Panel className="mb-6 grid grid-cols-2 tabular-nums sm:grid-cols-4 lg:grid-cols-6">
            {SUMMARY.filter((k) => pack.summary?.[k] !== null && pack.summary?.[k] !== undefined).map((k) => (
              <div key={k} className="px-4 py-3">
                <p className="text-[12px] text-muted">{METRICS[k].label}</p>
                <p className="text-[18px] font-semibold">{formatMetric(pack.summary![k], METRICS[k].format, ctx.business.currency)}</p>
              </div>
            ))}
          </Panel>
          {packSections(pack).map((s) => (
            <Panel key={s.file} className="mb-6 break-inside-avoid">
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <h2 className="text-[15px] font-semibold">{s.title}</h2>
                <a href={`/api/export/pack?${query({ section: s.file })}`} className="inline-flex items-center gap-1 text-[13px] text-signal hover:underline print:hidden">
                  <Download className="size-3.5" /> CSV
                </a>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px] tabular-nums">
                  <thead className="text-left text-[11.5px] text-muted">
                    <tr>{s.columns.map((c) => <th key={c} className="px-3 py-2 font-medium first:pl-5">{c}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {s.rows.map((r, i) => (
                      <tr key={i}>{r.map((v, j) => <td key={j} className="px-3 py-1.5 first:pl-5">{v === null || v === undefined || v === "" ? "—" : String(v)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}
        </>
      )}
    </>
  );
}
