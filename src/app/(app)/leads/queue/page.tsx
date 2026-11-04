import Link from "next/link";
import { LeadViewSwitch } from "@/components/crm/lead-view-switch";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel, StatusBadge } from "@/components/ui/primitives";
import { formatDateTime, formatPhone } from "@/lib/format";
import { getAssignmentSettings } from "@/modules/assignment/queries";
import { listSources, listStatuses } from "@/modules/leads/config";
import { listUnassignedLeads } from "@/modules/leads/queries";
import { listBranches, listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { AssignOne, RotationForm } from "./queue-forms";

export const metadata = { title: "Unassigned leads" };

export default async function QueuePage() {
  const ctx = await getContext();
  if (!can(ctx, "leads.view_all")) return <NoAccess what="the unassigned queue" />;
  const canAssign = can(ctx, "leads.assign");
  const businessId = ctx.business.businessId;

  const [statuses, sources, branches, members, settings] = await Promise.all([
    listStatuses(businessId),
    listSources(businessId),
    listBranches(businessId),
    listMembers(businessId),
    getAssignmentSettings(businessId),
  ]);
  const openIds = statuses.filter((s) => s.category === "open").map((s) => s.id);
  const { items, total } = await listUnassignedLeads(businessId, openIds);

  const status = new Map(statuses.map((s) => [s.id, s]));
  const source = new Map(sources.map((s) => [s.id, s.name]));
  const branch = new Map(branches.map((b) => [b.id, b.name]));
  const owners = members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name }));
  const inRotation = settings.members.some((m) => m.isActive);

  const rows = (
    <ul className="divide-y divide-line">
      {items.map((l) => {
        const s = status.get(l.statusId);
        return (
          <li key={l.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
            {canAssign && (
              <input type="checkbox" name="leadIds" value={l.id} form="rotation" aria-label={`Select ${l.leadNumber}`} className="hidden sm:block" />
            )}
            <div className="min-w-0 flex-1 text-[13.5px]">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/leads/${l.id}`} className="font-medium hover:text-signal">
                  {l.customer?.fullName ?? "Unknown"}
                </Link>
                {s && <StatusBadge stage={s.stage} name={s.name} />}
              </div>
              <p className="mt-0.5 text-[12.5px] text-muted">
                {l.leadNumber} · {formatPhone(l.customer?.phone)}
                {l.sourceId && source.get(l.sourceId) ? ` · ${source.get(l.sourceId)}` : ""}
                {l.branchId && branches.length > 1 ? ` · ${branch.get(l.branchId)}` : ""}
                {" · "}waiting since {formatDateTime(l.createdAt, ctx.business.timezone)}
              </p>
            </div>
            {canAssign && (
              <div className="sm:w-72">
                <AssignOne leadId={l.id} owners={owners} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <PageHeader
        title="Unassigned leads"
        description="Open leads with no owner, oldest first. Every lead should have an owner or sit here until it gets one."
        actions={<LeadViewSwitch current="/leads/queue" unassigned={total} />}
      />

      {canAssign && (
        <p className="mb-4 text-[13.5px] text-muted">
          Round-robin is <strong className="text-text">{settings.roundRobin ? "on" : "off"}</strong>
          {settings.roundRobin ? ": new leads without an owner are handed out automatically." : "."}{" "}
          {!inRotation && "Nobody is in the rotation yet. "}
          <Link href="/settings/assignment" className="font-medium text-signal hover:underline">
            Assignment settings
          </Link>
        </p>
      )}

      <Panel>
        {items.length === 0 ? (
          <EmptyState title="Every open lead has an owner">Nice. New unassigned leads will appear here.</EmptyState>
        ) : (
          <>
            {canAssign && <RotationForm count={items.length} />}
            {rows}
          </>
        )}
      </Panel>
      {total > items.length && (
        <p className="mt-3 text-[13px] text-muted">
          Showing the oldest {items.length} of {total}. Assign these to see more.
        </p>
      )}
    </>
  );
}
