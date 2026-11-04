import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { removeFromRotation, setRotationMemberActive, setRoundRobin } from "@/modules/assignment/actions";
import { getAssignmentSettings } from "@/modules/assignment/queries";
import { listBranches, listMembers, listRoles } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { AddToRotation } from "./rotation-form";

export const metadata = { title: "Lead assignment" };

export default async function AssignmentSettingsPage() {
  const ctx = await getContext();
  if (!can(ctx, "leads.assign")) return <NoAccess what="lead assignment" />;
  const businessId = ctx.business.businessId;
  const [settings, branches, members, roles] = await Promise.all([
    getAssignmentSettings(businessId),
    listBranches(businessId),
    listMembers(businessId),
    listRoles(businessId),
  ]);

  const grants = new Map(roles.map((r) => [r.id, new Set(r.permissions)]));
  const person = new Map(members.map((m) => [m.userId, m.name]));
  // Mirrors private.member_can_own_lead(): who could see a lead in this branch if it were theirs.
  const canOwn = (m: (typeof members)[number], branchId: string | null) => {
    const g = grants.get(m.roleId);
    if (!g || m.status !== "active") return false;
    if (g.has("leads.view_assigned")) return true;
    return g.has("leads.view_all") && (branchId === null || m.allBranches || m.branchIds.includes(branchId));
  };

  const pools = [
    { branchId: null as string | null, title: branches.length > 1 ? "Whole business" : "Rotation", note: branches.length > 1 ? "Used for leads with no branch, and for branches with nobody in their own rotation." : "New leads without an owner go to these people in turn." },
    ...(branches.length > 1
      ? branches.filter((b) => b.isActive).map((b) => ({ branchId: b.id as string | null, title: b.name, note: "Leads for this branch go here first." }))
      : []),
  ];

  return (
    <>
      <Link href="/settings" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Settings
      </Link>
      <PageHeader
        title="Lead assignment"
        description="Who owns new leads. Owners get a notification when a lead is assigned to them."
      />

      <Panel className="mb-6 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="text-[15px] font-semibold">Round-robin {settings.roundRobin ? "is on" : "is off"}</h2>
          <p className="mt-1 max-w-[60ch] text-[13.5px] text-muted">
            {settings.roundRobin
              ? "New leads that arrive without an owner (website, API, or added without choosing one) are handed out in turn."
              : "New leads without an owner wait in the unassigned queue until someone assigns them."}
          </p>
        </div>
        <ActionForm action={setRoundRobin}>
          <input type="hidden" name="enabled" value={String(!settings.roundRobin)} />
          <SubmitButton variant={settings.roundRobin ? "secondary" : "primary"}>
            {settings.roundRobin ? "Turn off" : "Turn on round-robin"}
          </SubmitButton>
        </ActionForm>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        {pools.map((pool) => {
          const inPool = settings.members.filter((m) => m.branchId === pool.branchId);
          const taken = new Set(inPool.map((m) => m.userId));
          const candidates = members
            .filter((m) => !taken.has(m.userId) && canOwn(m, pool.branchId))
            .map((m) => ({ value: m.userId, label: `${m.name} · ${m.roleName}` }));
          return (
            <Panel key={pool.branchId ?? "all"}>
              <div className="border-b border-line px-5 py-3.5">
                <h2 className="text-[15px] font-semibold">{pool.title}</h2>
                <p className="text-[13px] text-muted">{pool.note}</p>
              </div>
              {inPool.length > 0 ? (
                <ul className="divide-y divide-line">
                  {inPool.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13.5px]">
                      <span className={`flex-1 ${m.isActive ? "" : "text-muted line-through"}`}>
                        {person.get(m.userId) ?? "Former member"}
                      </span>
                      <span className="text-[12px] text-muted">
                        {m.lastAssignedAt ? `Last lead ${formatDateTime(m.lastAssignedAt, ctx.business.timezone)}` : "No leads yet"}
                      </span>
                      <ActionForm action={setRotationMemberActive}>
                        <input type="hidden" name="memberId" value={m.id} />
                        <input type="hidden" name="active" value={String(!m.isActive)} />
                        <SubmitButton variant="ghost">{m.isActive ? "Pause" : "Resume"}</SubmitButton>
                      </ActionForm>
                      <ActionForm action={removeFromRotation}>
                        <input type="hidden" name="memberId" value={m.id} />
                        <SubmitButton variant="ghost">Remove</SubmitButton>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-3 text-[13.5px] text-muted">Nobody yet.</p>
              )}
              <div className="border-t border-line p-4">
                <AddToRotation branchId={pool.branchId} people={candidates} />
              </div>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
