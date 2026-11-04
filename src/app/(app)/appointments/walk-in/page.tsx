import Link from "next/link";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { listBranches, listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { WalkInForm } from "../appointment-forms";

export const metadata = { title: "Register walk-in" };

export default async function WalkInPage() {
  const ctx = await getContext();
  if (!can(ctx, "appointments.manage")) return <NoAccess what="registering walk-ins" />;
  const businessId = ctx.business.businessId;
  const [branches, members] = await Promise.all([listBranches(businessId), listMembers(businessId)]);
  const me = members.find((m) => m.userId === ctx.user.id);
  return (
    <>
      <Link href="/appointments" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Appointments</Link>
      <PageHeader
        title="Register walk-in"
        description="Phone first. A returning customer joins their existing file and open lead; a new one gets a customer file and a walk-in lead. A booking for today is marked as arrived."
      />
      <Panel className="max-w-2xl p-5">
        <WalkInForm
          branches={branches.filter((b) => b.isActive).map((b) => ({ value: b.id, label: b.name }))}
          staff={members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name }))}
          defaultStaff={ctx.user.id}
          defaultBranch={me && !me.allBranches && me.branchIds.length === 1 ? me.branchIds[0] : ""}
        />
      </Panel>
    </>
  );
}
