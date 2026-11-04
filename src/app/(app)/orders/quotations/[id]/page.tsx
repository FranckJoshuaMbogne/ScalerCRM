import Link from "next/link";
import { notFound } from "next/navigation";
import { QuotationBadge } from "@/components/crm/order-badges";
import { QuickContact } from "@/components/crm/quick-contact";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { getCustomer } from "@/modules/customers/queries";
import { setQuotationStatus } from "@/modules/orders/actions";
import { editorData, toEditorLines } from "@/modules/orders/editor";
import { getQuotation } from "@/modules/orders/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { ConvertForm, EditLinesForm } from "../../order-forms";

export const metadata = { title: "Quotation" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function QuotationPage({ params, searchParams }: PageProps<"/orders/quotations/[id]">) {
  const ctx = await getContext();
  if (!can(ctx, "orders.view_all") && !can(ctx, "orders.view_assigned")) return <NoAccess what="quotations" />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const q = await getQuotation(id);
  if (!q) notFound();
  const [customer, editor] = await Promise.all([
    getCustomer(q.customerId),
    editorData(ctx.business.businessId, q.customerId, ctx.business.timezone),
  ]);
  const tz = ctx.business.timezone;
  const cur = ctx.business.currency;
  const live = q.status === "draft" || q.status === "sent";
  const canChange = can(ctx, "orders.edit") || (can(ctx, "orders.create") && q.createdBy === ctx.user.id);
  const phone = customer?.contacts.find((c) => c.kind === "phone")?.value ?? null;

  return (
    <>
      <Link href="/orders/quotations" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Quotations</Link>
      <PageHeader
        title={`${q.quotationNumber} · ${customer?.fullName ?? "Customer"}`}
        description={`Created ${formatDate(q.createdAt, tz)}${q.validUntil ? ` · valid until ${formatDate(`${q.validUntil}T12:00:00Z`, tz)}` : ""}`}
        actions={<QuotationBadge status={q.status} />}
      />
      {sp.created && (
        <p role="status" className="mb-4 rounded-[var(--radius-control)] bg-signal-soft px-3 py-2 text-[13.5px]">
          Quotation {q.quotationNumber} saved as a draft. Mark it as sent once you&apos;ve shared it.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Panel>
          <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Lines</h2>
          {live && canChange ? (
            <div className="p-5">
              <EditLinesForm kind="quotation" documentId={q.id} lines={toEditorLines(q.items)} currency={cur} {...editor} />
            </div>
          ) : (
            <ul className="divide-y divide-line text-[13.5px]">
              {q.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-4 px-5 py-2.5 tabular-nums">
                  <span>{Number(i.quantity)} × {i.description}</span>
                  <span>{formatMoney(i.lineTotal, cur)}</span>
                </li>
              ))}
              <li className="flex justify-between px-5 py-2.5 font-semibold tabular-nums">
                <span>Total</span>
                <span>{formatMoney(q.total, cur)}</span>
              </li>
            </ul>
          )}
        </Panel>

        <div className="flex flex-col gap-6">
          {q.orderId ? (
            <Panel className="p-5 text-[13.5px]">
              Accepted.{" "}
              <Link href={`/orders/${q.orderId}`} className="font-medium text-signal hover:underline">Open the order</Link>
            </Panel>
          ) : (
            live && canChange && (
              <Panel className="flex flex-col gap-4 p-5">
                <h2 className="text-[15px] font-semibold">Customer said yes?</h2>
                <ConvertForm quotationId={q.id} />
                <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                  {q.status === "draft" && (
                    <ActionForm action={setQuotationStatus}>
                      <input type="hidden" name="quotationId" value={q.id} />
                      <input type="hidden" name="status" value="sent" />
                      <SubmitButton variant="secondary">Mark as sent</SubmitButton>
                    </ActionForm>
                  )}
                  <ActionForm action={setQuotationStatus}>
                    <input type="hidden" name="quotationId" value={q.id} />
                    <input type="hidden" name="status" value="declined" />
                    <SubmitButton variant="danger">Declined</SubmitButton>
                  </ActionForm>
                </div>
              </Panel>
            )
          )}
          {customer && (
            <Panel className="p-5">
              <p className="text-[12.5px] font-medium text-muted">Customer</p>
              <Link href={`/customers/${customer.id}`} className="mt-1 block text-[15px] font-semibold hover:text-signal">{customer.fullName}</Link>
              <p className="text-[13px] text-muted">{customer.cifNumber}</p>
              <QuickContact phone={phone} className="mt-3" />
              {q.leadId && <Link href={`/leads/${q.leadId}`} className="mt-3 inline-block text-[13px] text-signal hover:underline">Lead</Link>}
            </Panel>
          )}
          {q.notes && <Panel className="p-5 text-[13.5px] whitespace-pre-line text-muted">{q.notes}</Panel>}
        </div>
      </div>
    </>
  );
}
