import Link from "next/link";
import type { CountryCode } from "libphonenumber-js";
import { Plus } from "lucide-react";
import { OrderStageBadge, PaymentBadge } from "@/components/crm/order-badges";
import { Pager } from "@/components/crm/pager";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDate, formatMoney, formatPhone } from "@/lib/format";
import { matchingCustomerIds } from "@/modules/leads/queries";
import { listOrders, listOrderStages, type OrderFilters, ORDERS_PAGE_SIZE } from "@/modules/orders/queries";
import { listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Orders" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const VIEWS = [
  { value: "open", label: "In progress" },
  { value: "closed", label: "Delivered or cancelled" },
  { value: "all", label: "Everything" },
] as const;
const selectClass = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[13.5px]";

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const ctx = await getContext();
  const canAll = can(ctx, "orders.view_all");
  if (!canAll && !can(ctx, "orders.view_assigned")) return <NoAccess what="orders" />;
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.value === one(sp.view))?.value ?? "open") as OrderFilters["view"];
  const filters: OrderFilters = {
    view,
    stage: one(sp.stage) || undefined,
    owner: one(sp.owner) || undefined,
    q: one(sp.q) || undefined,
    due: one(sp.due) === "overdue" ? "overdue" : "",
    page: Number(one(sp.page)) || 1,
  };
  const businessId = ctx.business.businessId;
  const [stages, members] = await Promise.all([listOrderStages(businessId), listMembers(businessId)]);
  const match = filters.q ? await matchingCustomerIds(businessId, filters.q, ctx.business.countryCode as CountryCode) : null;
  const { items, total } = await listOrders(businessId, ctx.user.id, filters, stages, filters.q ? (match?.ids ?? []) : null);
  const stage = new Map(stages.map((s) => [s.id, s]));
  const person = new Map(members.map((m) => [m.userId, m.name]));
  const tz = ctx.business.timezone;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order with its fulfilment stage and what is still owed."
        actions={
          <>
            <Link href="/orders/quotations" className={linkButton.secondary}>Quotations</Link>
            {can(ctx, "orders.create") && (
              <Link href="/orders/new" className={linkButton.primary}>
                <Plus className="size-4" /> New order
              </Link>
            )}
          </>
        }
      />

      <nav aria-label="Order views" className="mb-3 flex gap-1 overflow-x-auto">
        {VIEWS.map((v) => (
          <Link
            key={v.value}
            href={`/orders?view=${v.value}`}
            aria-current={view === v.value ? "page" : undefined}
            className="rounded-full px-3 py-1.5 text-[13px] whitespace-nowrap text-muted hover:bg-surface aria-[current=page]:bg-surface aria-[current=page]:font-medium aria-[current=page]:text-text aria-[current=page]:shadow-sm"
          >
            {v.label}
          </Link>
        ))}
      </nav>

      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <input type="hidden" name="view" value={view} />
        <label className="min-w-[200px] flex-1">
          <span className="sr-only">Search orders</span>
          <input type="search" name="q" defaultValue={filters.q} placeholder="Order number, customer name or phone" className={`${selectClass} w-full px-3`} />
        </label>
        <select name="stage" defaultValue={filters.stage ?? ""} aria-label="Stage" className={selectClass}>
          <option value="">All stages</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {canAll && (
          <select name="owner" defaultValue={filters.owner ?? ""} aria-label="Salesperson" className={selectClass}>
            <option value="">Anyone</option>
            <option value="me">Mine</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
          </select>
        )}
        <label className="flex h-9 items-center gap-1.5 text-[13px]">
          <input type="checkbox" name="due" value="overdue" defaultChecked={filters.due === "overdue"} /> Past delivery date
        </label>
        <button type="submit" className={linkButton.secondary}>Apply</button>
      </form>

      <Panel>
        {items.length === 0 ? (
          <EmptyState title="No orders here yet">
            Orders start from a customer file, a lead or an accepted quotation.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead className="border-b border-line text-left text-[12.5px] text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Order</th>
                  <th className="px-3 py-2.5 font-medium">Customer</th>
                  <th className="px-3 py-2.5 font-medium">Stage</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Delivery</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Salesperson</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-5 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((o) => {
                  const s = stage.get(o.stageId);
                  const late = o.dueDate && o.dueDate < today && s?.category === "open";
                  return (
                    <tr key={o.id} className="hover:bg-paper/60">
                      <td className="px-5 py-2.5">
                        <Link href={`/orders/${o.id}`} className="font-medium hover:text-signal">{o.orderNumber}</Link>
                        <p className="text-[12px] text-muted">{formatDate(o.createdAt, tz)}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        {o.customer ? (
                          <Link href={`/customers/${o.customer.id}`} className="hover:text-signal">{o.customer.fullName}</Link>
                        ) : "—"}
                        <p className="text-[12px] text-muted tabular-nums">{formatPhone(o.customer?.phone)}</p>
                      </td>
                      <td className="px-3 py-2.5">{s && <OrderStageBadge name={s.name} category={s.category} />}</td>
                      <td className={`hidden px-3 py-2.5 tabular-nums md:table-cell ${late ? "font-medium text-danger" : "text-muted"}`}>
                        {o.dueDate ? formatDate(`${o.dueDate}T12:00:00Z`, tz) : "—"}
                      </td>
                      <td className="hidden px-3 py-2.5 text-muted md:table-cell">
                        {o.ownerId ? (person.get(o.ownerId) ?? "Former member") : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(o.total, ctx.business.currency)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        <p>{formatMoney(o.balance, ctx.business.currency)}</p>
                        <PaymentBadge total={o.total} netPaid={o.netPaid} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Pager basePath="/orders" params={sp} page={filters.page ?? 1} pageSize={ORDERS_PAGE_SIZE} total={total} />
    </>
  );
}
