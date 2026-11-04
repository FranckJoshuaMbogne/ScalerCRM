import Link from "next/link";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { listImportJobs } from "@/modules/imports/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import data" };
// Imports run inside the server action; 50,000 rows take a few minutes.
export const maxDuration = 300;

export default async function ImportPage() {
  const ctx = await getContext();
  if (!can(ctx, "data.import")) return <NoAccess what="data import" />;
  const jobs = await listImportJobs(ctx.business.businessId);
  const tz = ctx.business.timezone;

  return (
    <>
      <Link href="/settings" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Settings
      </Link>
      <PageHeader
        title="Import data"
        description="Bring customers, leads and orders from spreadsheets or another system. Import customers first, then leads, then orders."
      />

      <Panel className="mb-6 p-5">
        <ImportForm />
      </Panel>

      <Panel>
        <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Recent imports</h2>
        {jobs.length === 0 ? (
          <EmptyState title="Nothing imported yet" />
        ) : (
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li key={j.id} className="px-5 py-3.5 text-[13.5px]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {j.fileName} <span className="font-normal text-muted">· {j.kind}</span>
                  </p>
                  <p className="text-muted">
                    {formatDateTime(j.createdAt, tz)}
                    {j.by ? ` · ${j.by}` : ""}
                    {j.status === "running" ? " · stopped before the end" : ""}
                  </p>
                </div>
                <p className="mt-1 text-muted">
                  {j.totalRows.toLocaleString("en-IN")} rows: {j.created} new, {j.matched} matched, {j.skipped} already imported,{" "}
                  {j.failed} refused
                </p>
                {j.errors.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-signal">Refused rows</summary>
                    <ul className="mt-1 space-y-0.5 text-muted">
                      {j.errors.slice(0, 50).map((e) => (
                        <li key={e.row}>
                          Row {e.row}: {e.error}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
