import Link from "next/link";
import { Plus } from "lucide-react";
import { QuotationBadge } from "@/components/crm/order-badges";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { listQuotations } from "@/modules/orders/queries";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Quotations" };

const STATUSES = [
  { value: "", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
] as const;

export default async function QuotationsPage({ searchParams }: PageProps<"/orders/quotations">) {
  const ctx = await getContext();
  if (!can(ctx, "orders.view_all") && !can(ctx, "orders.view_assigned")) return <NoAccess what="quotations" />;
  const raw = (await searchParams).status;
  const status = STATUSES.find((s) => s.value === raw)?.value ?? "";
  const items = await listQuotations(ctx.business.businessId, status || undefined);
  const tz = ctx.business.timezone;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Link href="/orders" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Orders</Link>
      <PageHeader
        title="Quotations"
        description="Price quotes sent to customers. Accepting one creates the order with the same lines."
        actions={
          can(ctx, "orders.create") ? (
            <Link href="/orders/new?kind=quotation" className={linkButton.primary}>
              <Plus className="size-4" /> New quotation
            </Link>
          ) : undefined
        }
      />
      <nav aria-label="Quotation status" className="mb-3 flex gap-1 overflow-x-auto">
        {STATUSES.map((s) => (
          <Link
            key={s.value}
            href={s.value ? `/orders/quotations?status=${s.value}` : "/orders/quotations"}
            aria-current={status === s.value ? "page" : undefined}
            className="rounded-full px-3 py-1.5 text-[13px] text-muted hover:bg-surface aria-[current=page]:bg-surface aria-[current=page]:font-medium aria-[current=page]:text-text aria-[current=page]:shadow-sm"
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <Panel>
        {items.length === 0 ? (
          <EmptyState title="No quotations here" />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((q) => (
              <li key={q.id}>
                <Link href={`/orders/quotations/${q.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13.5px] hover:bg-paper/60">
                  <span className="w-24 font-medium">{q.quotationNumber}</span>
                  <span className="min-w-0 flex-1 truncate">{q.customer?.fullName ?? "—"}</span>
                  <span className={`text-[12.5px] ${q.validUntil && q.validUntil < today && (q.status === "draft" || q.status === "sent") ? "text-danger" : "text-muted"}`}>
                    {q.validUntil ? `valid until ${formatDate(`${q.validUntil}T12:00:00Z`, tz)}` : ""}
                  </span>
                  <span className="tabular-nums">{formatMoney(q.total, ctx.business.currency)}</span>
                  <QuotationBadge status={q.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
