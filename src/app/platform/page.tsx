import Link from "next/link";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { listPlatformBusinesses, requirePlatformAdmin } from "@/modules/plans/platform";

export const metadata = { title: "Businesses" };

const n = (v: number | undefined) => Number(v ?? 0).toLocaleString("en-IN");

export default async function PlatformHome(props: PageProps<"/platform">) {
  await requirePlatformAdmin();
  const { status } = (await props.searchParams) as { status?: string };
  const all = await listPlatformBusinesses();
  const list = status ? all.filter((b) => b.status === status) : all;
  const counts = { active: all.filter((b) => b.status === "active").length, suspended: all.filter((b) => b.status === "suspended").length };

  return (
    <>
      <PageHeader
        title="Businesses"
        description={`${all.length} businesses · ${counts.active} active · ${counts.suspended} suspended`}
        actions={
          <div className="flex gap-2 text-[13.5px]">
            {[["", "All"], ["active", "Active"], ["suspended", "Suspended"]].map(([v, label]) => (
              <Link
                key={label}
                href={v ? `/platform?status=${v}` : "/platform"}
                className={(status ?? "") === v ? "font-semibold text-signal" : "text-muted hover:text-text"}
              >
                {label}
              </Link>
            ))}
          </div>
        }
      />
      <Panel className="overflow-x-auto">
        {list.length === 0 ? (
          <EmptyState title="No businesses" />
        ) : (
          <table className="w-full min-w-[820px] text-left text-[13.5px]">
            <thead className="border-b border-line text-[12.5px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Business</th>
                <th className="px-4 py-2.5 font-medium">Plan</th>
                <th className="px-4 py-2.5 font-medium">Users</th>
                <th className="px-4 py-2.5 font-medium">Branches</th>
                <th className="px-4 py-2.5 font-medium">Messages (month)</th>
                <th className="px-4 py-2.5 font-medium">Leads (30 days)</th>
                <th className="px-4 py-2.5 font-medium">Since</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3">
                    <Link href={`/platform/${b.id}`} className="font-medium text-signal hover:underline">
                      {b.name}
                    </Link>
                    <p className="text-[12.5px] text-muted">
                      {b.adminEmail ?? "no admin"}
                      {b.status === "suspended" && <span className="ml-2 text-danger">suspended</span>}
                      {b.supportOpen && <span className="ml-2">· support open</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {b.planKey}
                    {b.trialEndsAt && <p className="text-[12.5px] text-muted">trial to {formatDateTime(b.trialEndsAt, "Asia/Kolkata")}</p>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{n(b.usage.max_users)}</td>
                  <td className="px-4 py-3 tabular-nums">{n(b.usage.max_branches)}</td>
                  <td className="px-4 py-3 tabular-nums">{n(b.usage.monthly_messages)}</td>
                  <td className="px-4 py-3 tabular-nums">{n(b.leads30d)}</td>
                  <td className="px-4 py-3 text-muted">{formatDateTime(b.createdAt, "Asia/Kolkata")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
