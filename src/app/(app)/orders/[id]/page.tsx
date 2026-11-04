import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { OrderStageBadge, PaymentBadge } from "@/components/crm/order-badges";
import { QuickContact } from "@/components/crm/quick-contact";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { listOrderAppointments } from "@/modules/appointments/queries";
import { formatCustomValue } from "@/modules/custom-fields/engine";
import { listFieldDefinitions } from "@/modules/custom-fields/queries";
import { getCustomer } from "@/modules/customers/queries";
import { editorData, toEditorLines } from "@/modules/orders/editor";
import { getOrder, listOrderStages } from "@/modules/orders/queries";
import { toLocalInput } from "@/modules/tasks/schedule";
import { listBranches, listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { EditLinesForm, OrderDetailsForm, PaymentForm, StageForm } from "../order-forms";

export const metadata = { title: "Order" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHOD: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank transfer", cheque: "Cheque", other: "Other" };
const KIND: Record<string, string> = { consultation: "Consultation", measurement: "Measurement", trial: "Trial", alteration: "Alteration", delivery: "Delivery", other: "Appointment" };

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const ctx = await getContext();
  if (!can(ctx, "orders.view_all") && !can(ctx, "orders.view_assigned")) return <NoAccess what="orders" />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const businessId = ctx.business.businessId;
  const order = await getOrder(id, can(ctx, "payments.view"));
  if (!order) notFound();

  const [stages, customer, members, branches, fields, appointments, editor] = await Promise.all([
    listOrderStages(businessId),
    getCustomer(order.customerId),
    listMembers(businessId),
    listBranches(businessId),
    listFieldDefinitions(businessId, "order"),
    can(ctx, "appointments.view") ? listOrderAppointments(id) : Promise.resolve([]),
    editorData(businessId, order.customerId, ctx.business.timezone),
  ]);
  const stage = new Map(stages.map((s) => [s.id, s]));
  const current = stage.get(order.stageId);
  const open = current?.category === "open";
  const person = new Map(members.map((m) => [m.userId, m.name]));
  const tz = ctx.business.timezone;
  const cur = ctx.business.currency;
  const canMove = can(ctx, "orders.edit") || can(ctx, "orders.fulfil");
  const canEdit = can(ctx, "orders.edit");
  const phone = customer?.contacts.find((c) => c.kind === "phone" && c.isPrimary)?.value ?? customer?.contacts.find((c) => c.kind === "phone")?.value ?? null;
  const measurementLabel = new Map(editor.measurements.map((m) => [m.id, m.label]));

  return (
    <>
      <Link href="/orders" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Orders</Link>
      <PageHeader
        title={`${order.orderNumber} · ${customer?.fullName ?? "Customer"}`}
        description={`Created ${formatDate(order.createdAt, tz)}${order.dueDate ? ` · delivery ${formatDate(`${order.dueDate}T12:00:00Z`, tz)}` : ""}`}
        actions={
          <>
            {current && <OrderStageBadge name={current.name} category={current.category} />}
            <PaymentBadge total={order.total} netPaid={order.netPaid} />
          </>
        }
      />
      {sp.created && (
        <p role="status" className="mb-4 rounded-[var(--radius-control)] bg-signal-soft px-3 py-2 text-[13.5px]">
          Order {order.orderNumber} created. Record an advance below if the customer paid one.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel>
            <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Lines</h2>
            {canEdit && open ? (
              <div className="p-5">
                <EditLinesForm kind="order" documentId={order.id} lines={toEditorLines(order.items)} currency={cur} {...editor} />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px] tabular-nums">
                  <thead className="border-b border-line text-left text-[12.5px] text-muted">
                    <tr>
                      <th className="px-5 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Price</th>
                      <th className="px-3 py-2 text-right font-medium">Discount</th>
                      <th className="px-3 py-2 text-right font-medium">Tax</th>
                      <th className="px-5 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {order.items.map((i) => (
                      <tr key={i.id}>
                        <td className="px-5 py-2.5">
                          {i.description}
                          {(i.garment || i.fabric || i.measurementId) && (
                            <p className="text-[12px] text-muted">
                              {[i.garment, i.fabric, i.measurementId && measurementLabel.get(i.measurementId)].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">{Number(i.quantity)}</td>
                        <td className="px-3 py-2.5 text-right">{formatMoney(i.unitPrice, cur)}</td>
                        <td className="px-3 py-2.5 text-right">{Number(i.discount) ? `−${formatMoney(i.discount, cur)}` : "—"}</td>
                        <td className="px-3 py-2.5 text-right">{Number(i.taxRate) ? `${Number(i.taxRate)}%` : "—"}</td>
                        <td className="px-5 py-2.5 text-right font-medium">{formatMoney(i.lineTotal, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <dl className="ml-auto grid max-w-xs grid-cols-2 gap-y-1 px-5 py-3 text-[13.5px] tabular-nums">
                  <dt className="text-muted">Subtotal</dt><dd className="text-right">{formatMoney(order.subtotal, cur)}</dd>
                  <dt className="text-muted">Discounts</dt><dd className="text-right">−{formatMoney(order.discountTotal, cur)}</dd>
                  <dt className="text-muted">Tax</dt><dd className="text-right">{formatMoney(order.taxTotal, cur)}</dd>
                  <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{formatMoney(order.total, cur)}</dd>
                </dl>
              </div>
            )}
          </Panel>

          <Panel>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">Payments</h2>
              <p className="text-[13.5px] tabular-nums">
                Paid {formatMoney(order.netPaid, cur)} of {formatMoney(order.total, cur)} ·{" "}
                <span className={Number(order.balance) > 0 ? "font-semibold" : "text-muted"}>
                  {Number(order.balance) < 0 ? `Refund due ${formatMoney(String(-Number(order.balance)), cur)}` : `Balance ${formatMoney(order.balance, cur)}`}
                </span>
              </p>
            </div>
            {order.payments === null ? (
              <p className="px-5 py-4 text-[13.5px] text-muted">You don&apos;t have access to payment details.</p>
            ) : order.payments.length === 0 ? (
              <EmptyState title="No payments yet" />
            ) : (
              <ul className="divide-y divide-line">
                {order.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3 text-[13.5px]">
                    <span className="w-28 font-medium">{p.receiptNumber}</span>
                    <span className={`tabular-nums ${p.kind === "refund" ? "text-danger" : ""}`}>
                      {p.kind === "refund" ? "−" : ""}{formatMoney(p.amount, cur)}
                    </span>
                    <span className="text-muted">{METHOD[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                    <span className="ml-auto text-[12.5px] text-muted">
                      {formatDateTime(p.receivedAt, tz)} · {p.recordedBy ? (person.get(p.recordedBy) ?? "Former member") : "System"}
                    </span>
                    {p.notes && <p className="basis-full text-[12.5px] text-muted">{p.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
            {(can(ctx, "payments.record") || can(ctx, "payments.refund")) && (
              <div className="grid gap-5 border-t border-line p-5 xl:grid-cols-2">
                {can(ctx, "payments.record") && current?.category !== "cancelled" && Number(order.balance) > 0 && (
                  <div>
                    <h3 className="mb-3 text-[14px] font-semibold">Record a payment</h3>
                    <PaymentForm orderId={order.id} kind="payment" balance={order.balance} />
                  </div>
                )}
                {can(ctx, "payments.refund") && Number(order.netPaid) > 0 && (
                  <details>
                    <summary className="cursor-pointer text-[14px] font-semibold select-none">Record a refund</summary>
                    <div className="mt-3"><PaymentForm orderId={order.id} kind="refund" balance={order.balance} /></div>
                  </details>
                )}
              </div>
            )}
          </Panel>

          {can(ctx, "appointments.view") && (
            <Panel>
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <h2 className="text-[15px] font-semibold">Trials and fittings</h2>
                {can(ctx, "appointments.manage") && open && (
                  <Link href={`/appointments/new?customer=${order.customerId}&order=${order.id}&kind=trial`} className={linkButton.secondary}>
                    <CalendarPlus className="size-4" /> Book
                  </Link>
                )}
              </div>
              {appointments.length === 0 ? (
                <p className="px-5 py-4 text-[13.5px] text-muted">Nothing booked for this order.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {appointments.map((a) => (
                    <li key={a.id} className="flex flex-wrap gap-x-4 px-5 py-3 text-[13.5px]">
                      <span className="font-medium">{KIND[a.kind]}</span>
                      <Link href={`/appointments?date=${toLocalInput(new Date(a.startsAt), tz).slice(0, 10)}`} className="hover:text-signal">
                        {formatDateTime(a.startsAt, tz)}
                      </Link>
                      <span className="text-muted capitalize">{a.status.replace("_", "-")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Panel className="p-5">
            {canMove ? (
              <StageForm
                orderId={order.id}
                stageId={order.stageId}
                stages={stages
                  .filter((s) => s.isActive || s.id === order.stageId)
                  .filter((s) => canEdit || (s.category !== "cancelled" && open) || s.id === order.stageId)
                  .map((s) => ({ value: s.id, label: s.name }))}
              />
            ) : (
              <p className="text-[13.5px]">Stage: {current?.name}</p>
            )}
            <ol className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3 text-[12.5px]">
              {order.history.map((h) => (
                <li key={h.id} className="flex justify-between gap-3">
                  <span>{stage.get(h.toStageId)?.name ?? "?"} <span className="text-muted">· {h.changedBy ? (person.get(h.changedBy) ?? "Former member") : "System"}</span></span>
                  <time className="text-muted tabular-nums">{formatDateTime(h.changedAt, tz)}</time>
                </li>
              ))}
            </ol>
          </Panel>

          {customer && (
            <Panel className="p-5">
              <p className="text-[12.5px] font-medium text-muted">Customer</p>
              <Link href={`/customers/${customer.id}`} className="mt-1 block text-[15px] font-semibold hover:text-signal">{customer.fullName}</Link>
              <p className="text-[13px] text-muted">{customer.cifNumber}</p>
              <QuickContact phone={phone} className="mt-3" />
              <p className="mt-3 flex flex-wrap gap-x-3 text-[13px]">
                {order.leadId && <Link href={`/leads/${order.leadId}`} className="text-signal hover:underline">Lead</Link>}
                {order.quotationId && <Link href={`/orders/quotations/${order.quotationId}`} className="text-signal hover:underline">Quotation</Link>}
              </p>
            </Panel>
          )}

          <Panel className="p-5 text-[13.5px]">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted">Salesperson</dt>
              <dd>{order.ownerId ? (person.get(order.ownerId) ?? "Former member") : "—"}</dd>
              {fields.map((f) => (
                <div key={f.key} className="contents">
                  <dt className="text-muted">{f.label}</dt>
                  <dd>{formatCustomValue(f, order.customFields[f.key])}</dd>
                </div>
              ))}
            </dl>
            {order.notes && <p className="mt-3 whitespace-pre-line text-muted">{order.notes}</p>}
            {canEdit && (
              <details className="mt-4 border-t border-line pt-3">
                <summary className="cursor-pointer text-[14px] font-semibold select-none">Edit details</summary>
                <div className="mt-4">
                  <OrderDetailsForm
                    order={order}
                    branches={branches.filter((b) => b.isActive || b.id === order.branchId).map((b) => ({ value: b.id, label: b.name }))}
                    owners={can(ctx, "orders.view_all") ? members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name })) : []}
                    fields={fields}
                  />
                </div>
              </details>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
