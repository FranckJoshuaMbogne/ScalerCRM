import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { revokeInvitation, setMemberStatus } from "@/modules/team/actions";
import { listBranches, listMembers, listPendingInvitations, listRoles } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { EditMemberForm, InviteForm } from "./team-forms";

export const metadata = { title: "Team & roles" };

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function TeamPage() {
  const ctx = await getContext();
  const businessId = ctx.business.businessId;
  const manage = can(ctx, "team.members.manage");

  const [members, roles, branches, invitations] = await Promise.all([
    listMembers(businessId),
    listRoles(businessId),
    listBranches(businessId),
    manage ? listPendingInvitations(businessId) : Promise.resolve([]),
  ]);

  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name }));
  const branchOptions = branches.filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name }));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const accessLabel = (all: boolean, ids: string[]) =>
    all ? "All branches" : ids.map((id) => branchName.get(id) ?? "Unknown").join(", ") || "No branches";

  return (
    <>
      <PageHeader
        title="Team & roles"
        description={`People who work in ${ctx.business.businessName}, what they can do, and which branches they see.`}
        actions={
          <Link
            href="/team/roles"
            className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3.5 text-[13.5px] font-medium hover:bg-paper"
          >
            Roles and permissions
          </Link>
        }
      />

      {manage && (
        <Panel className="mb-6 p-5">
          <h2 className="mb-1 text-[15px] font-semibold">Invite someone</h2>
          <p className="mb-5 text-[13.5px] text-muted">
            You&apos;ll get a link to send them on WhatsApp or email. They sign in with the address you enter here.
          </p>
          <InviteForm roles={roleOptions} branches={branchOptions} />
        </Panel>
      )}

      <Panel className="mb-6">
        <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">
          Members <span className="font-normal text-muted">({members.length})</span>
        </h2>
        <ul className="divide-y divide-line">
          {members.map((m) => {
            const self = m.userId === ctx.user.id;
            return (
              <li key={m.membershipId} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                  <div className="min-w-[200px] flex-1">
                    <p className="text-[14px] font-medium">
                      {m.name} {self && <span className="font-normal text-muted">(you)</span>}
                    </p>
                    <p className="text-[12.5px] text-muted">{m.email}</p>
                  </div>
                  <p className="w-40 text-[13.5px]">{m.roleName}</p>
                  <p className="w-48 truncate text-[13px] text-muted">{accessLabel(m.allBranches, m.branchIds)}</p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[12px] font-medium",
                      m.status === "active" ? "bg-stage-won/10 text-stage-won" : "bg-stage-negotiation/10 text-stage-negotiation",
                    )}
                  >
                    {m.status === "active" ? "Active" : "Paused"}
                  </span>
                </div>

                {manage && !self && (
                  <details className="group mt-2">
                    <summary className="cursor-pointer text-[13px] font-medium text-signal select-none">
                      Change access
                    </summary>
                    <div className="mt-3 flex flex-col gap-5 rounded-[var(--radius-control)] border border-line p-4">
                      <EditMemberForm
                        membershipId={m.membershipId}
                        roleId={m.roleId}
                        allBranches={m.allBranches}
                        branchIds={m.branchIds}
                        roles={roleOptions}
                        branches={branchOptions}
                      />
                      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                        <ActionForm action={setMemberStatus} className="flex flex-wrap items-start">
                          <input type="hidden" name="membershipId" value={m.membershipId} />
                          <input type="hidden" name="status" value={m.status === "active" ? "suspended" : "active"} />
                          <SubmitButton variant="secondary">
                            {m.status === "active" ? "Pause access" : "Restore access"}
                          </SubmitButton>
                        </ActionForm>
                        <ActionForm action={setMemberStatus} className="flex flex-wrap items-start">
                          <input type="hidden" name="membershipId" value={m.membershipId} />
                          <input type="hidden" name="status" value="removed" />
                          <SubmitButton variant="danger">Remove from business</SubmitButton>
                        </ActionForm>
                      </div>
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      {manage && invitations.length > 0 && (
        <Panel>
          <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Waiting to join</h2>
          <ul className="divide-y divide-line">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
                <p className="min-w-[200px] flex-1 text-[14px]">{inv.email}</p>
                <p className="w-40 text-[13.5px]">{inv.roleName}</p>
                <p className="w-48 truncate text-[13px] text-muted">{accessLabel(inv.allBranches, inv.branchIds)}</p>
                <p className="text-[12.5px] text-muted">Expires {dateFmt.format(new Date(inv.expiresAt))}</p>
                <ActionForm action={revokeInvitation}>
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <SubmitButton variant="ghost">Cancel invitation</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
