import Link from "next/link";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { listBranches } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { NewCustomerForm } from "../customer-forms";

export const metadata = { title: "Add customer" };

export default async function NewCustomerPage() {
  const ctx = await getContext();
  if (!can(ctx, "customers.create")) return <NoAccess what="adding customers" />;
  const branches = await listBranches(ctx.business.businessId);
  return (
    <>
      <Link href="/customers" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Customers
      </Link>
      <PageHeader
        title="Add customer"
        description="If the phone number or email is already on file you'll be taken to that customer instead. To record an enquiry, add a lead."
      />
      <Panel className="max-w-2xl p-5">
        <NewCustomerForm branches={branches.filter((b) => b.isActive).map((b) => ({ value: b.id, label: b.name }))} />
      </Panel>
    </>
  );
}
