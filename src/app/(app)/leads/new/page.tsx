import Link from "next/link";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { listFieldDefinitions } from "@/modules/custom-fields/queries";
import { getCustomer } from "@/modules/customers/queries";
import { listSources, listStatuses } from "@/modules/leads/config";
import { listBranches, listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { NewLeadForm } from "../lead-forms";

export const metadata = { title: "Add lead" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewLeadPage({ searchParams }: PageProps<"/leads/new">) {
  const ctx = await getContext();
  if (!can(ctx, "leads.create")) return <NoAccess what="adding leads" />;
  const id = ctx.business.businessId;
  const customerParam = (await searchParams).customer;
  const customerId = typeof customerParam === "string" && UUID.test(customerParam) ? customerParam : null;
  const [customer, statuses, sources, branches, members, fields] = await Promise.all([
    customerId ? getCustomer(customerId) : Promise.resolve(null),
    listStatuses(id),
    listSources(id),
    listBranches(id),
    can(ctx, "leads.assign") ? listMembers(id) : Promise.resolve([]),
    listFieldDefinitions(id, "lead"),
  ]);

  return (
    <>
      <Link href="/leads" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Leads
      </Link>
      <PageHeader
        title="Add lead"
        description="Enter the phone number first. If it's already on file, the lead joins that customer's file instead of creating a duplicate."
      />
      <Panel className="max-w-3xl p-5">
        <NewLeadForm
          customer={customer && !customer.mergedIntoId ? { id: customer.id, label: `${customer.fullName} · ${customer.cifNumber}` } : null}
          statuses={statuses.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name, isDefault: s.isDefault }))}
          sources={sources.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))}
          branches={branches.filter((b) => b.isActive).map((b) => ({ value: b.id, label: b.name }))}
          owners={members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name }))}
          fields={fields}
          currency={ctx.business.currency}
        />
      </Panel>
    </>
  );
}
