import Link from "next/link";
import { notFound } from "next/navigation";
import type { CountryCode } from "libphonenumber-js";
import { CustomerPicker } from "@/components/crm/customer-picker";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { getCustomer } from "@/modules/customers/queries";
import { toLocalInput } from "@/modules/tasks/schedule";
import { listBranches, listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { BookForm, KIND_OPTIONS } from "../appointment-forms";

export const metadata = { title: "Book appointment" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function BookPage({ searchParams }: PageProps<"/appointments/new">) {
  const ctx = await getContext();
  if (!can(ctx, "appointments.manage")) return <NoAccess what="booking appointments" />;
  const sp = await searchParams;
  const customerId = UUID.test(one(sp.customer)) ? one(sp.customer) : null;
  const kind = KIND_OPTIONS.some((k) => k.value === one(sp.kind)) ? one(sp.kind) : "consultation";
  const businessId = ctx.business.businessId;

  if (!customerId) {
    return (
      <>
        <Link href="/appointments" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Appointments</Link>
        <PageHeader title="Book appointment" description="Find the customer first. New enquiries can be added as a lead or walk-in." />
        <Panel className="max-w-2xl p-5">
          <CustomerPicker businessId={businessId} country={ctx.business.countryCode as CountryCode} q={one(sp.q)}
            hrefFor={(id) => `/appointments/new?customer=${id}&kind=${kind}`} />
        </Panel>
      </>
    );
  }

  const [customer, branches, members] = await Promise.all([getCustomer(customerId), listBranches(businessId), listMembers(businessId)]);
  if (!customer || customer.mergedIntoId) notFound();
  return (
    <>
      <Link href={`/customers/${customer.id}`} className="mb-3 inline-block text-[13.5px] text-signal hover:underline">{customer.fullName}</Link>
      <PageHeader title="Book appointment" description={`${customer.fullName} · ${customer.cifNumber}. The staff member gets a notification and a reminder an hour before.`} />
      <Panel className="max-w-2xl p-5">
        <BookForm
          customerId={customer.id}
          leadId={UUID.test(one(sp.lead)) ? one(sp.lead) : null}
          orderId={UUID.test(one(sp.order)) ? one(sp.order) : null}
          kind={kind}
          branches={branches.filter((b) => b.isActive).map((b) => ({ value: b.id, label: b.name }))}
          staff={members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name }))}
          defaultStaff={ctx.user.id}
          minDate={toLocalInput(new Date(), ctx.business.timezone)}
        />
      </Panel>
    </>
  );
}
