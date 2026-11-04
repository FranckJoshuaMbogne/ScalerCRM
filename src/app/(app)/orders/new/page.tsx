import Link from "next/link";
import { notFound } from "next/navigation";
import type { CountryCode } from "libphonenumber-js";
import { CustomerPicker } from "@/components/crm/customer-picker";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { formatPhone } from "@/lib/format";
import { listFieldDefinitions } from "@/modules/custom-fields/queries";
import { getCustomer } from "@/modules/customers/queries";
import { editorData } from "@/modules/orders/editor";
import { listBranches, listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { NewDocumentForm } from "../order-forms";

export const metadata = { title: "New order" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  const ctx = await getContext();
  if (!can(ctx, "orders.create")) return <NoAccess what="creating orders" />;
  const sp = await searchParams;
  const kind = one(sp.kind) === "quotation" ? "quotation" : "order";
  const customerId = UUID.test(one(sp.customer)) ? one(sp.customer) : null;
  const leadId = UUID.test(one(sp.lead)) ? one(sp.lead) : null;
  const title = kind === "order" ? "New order" : "New quotation";
  const businessId = ctx.business.businessId;

  if (!customerId) {
    return (
      <>
        <Link href={kind === "order" ? "/orders" : "/orders/quotations"} className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
          {kind === "order" ? "Orders" : "Quotations"}
        </Link>
        <PageHeader title={title} description="Find the customer first. Orders and quotations always belong to a customer file." />
        <Panel className="max-w-2xl p-5">
          <CustomerPicker
            businessId={businessId}
            country={ctx.business.countryCode as CountryCode}
            q={one(sp.q)}
            hrefFor={(id) => `/orders/new?kind=${kind}&customer=${id}`}
          />
        </Panel>
      </>
    );
  }

  const [customer, branches, members, fields, editor] = await Promise.all([
    getCustomer(customerId),
    listBranches(businessId),
    can(ctx, "orders.view_all") ? listMembers(businessId) : Promise.resolve([]),
    listFieldDefinitions(businessId, "order"),
    editorData(businessId, customerId, ctx.business.timezone),
  ]);
  if (!customer || customer.mergedIntoId) notFound();

  return (
    <>
      <Link href={`/customers/${customer.id}`} className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        {customer.fullName}
      </Link>
      <PageHeader
        title={title}
        description={`${customer.fullName} · ${customer.cifNumber} · ${formatPhone(customer.contacts.find((c) => c.kind === "phone")?.value)}`}
      />
      <Panel className="max-w-4xl p-5">
        <NewDocumentForm
          kind={kind}
          customerId={customer.id}
          leadId={leadId}
          branches={branches.filter((b) => b.isActive).map((b) => ({ value: b.id, label: b.name }))}
          owners={members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name }))}
          fields={fields}
          currency={ctx.business.currency}
          {...editor}
        />
      </Panel>
    </>
  );
}
