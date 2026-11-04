import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { NoAccess } from "@/components/ui/no-access";
import { formatDate, formatMoney } from "@/lib/format";
import { stateName } from "@/modules/billing/gst";
import { getInvoice } from "@/modules/billing/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { PrintButton } from "@/app/(app)/analytics/print-button";

export const metadata = { title: "Invoice" };

const SUPPLY: Record<string, string> = {
  intra_state: "Intra-state supply",
  inter_state: "Inter-state supply",
  export: "Export of services (zero-rated)",
};

function Party({ title, p }: { title: string; p: Record<string, string | null> }) {
  return (
    <div className="text-[13.5px] leading-relaxed">
      <p className="mb-1 text-[12px] font-semibold tracking-wide text-muted uppercase">{title}</p>
      <p className="font-medium">{p.legal_name}</p>
      {p.address && <p>{p.address}</p>}
      {(p.city || p.postal_code) && <p>{[p.city, p.postal_code].filter(Boolean).join(" ")}</p>}
      {p.state_code && <p>State: {stateName(p.state_code)} ({p.state_code})</p>}
      <p>GSTIN: {p.gstin ?? "Unregistered"}</p>
      {p.email && <p>{p.email}</p>}
    </div>
  );
}

/** A GST invoice laid out for the browser's "Save as PDF". */
export default async function InvoicePage(props: PageProps<"/settings/billing/invoices/[id]">) {
  const ctx = await getContext();
  if (!can(ctx, "billing.manage")) return <NoAccess what="invoices" />;
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const inv = await getInvoice(id);
  if (!inv) notFound();
  const tz = ctx.business.timezone;
  const money = (v: string) => formatMoney(v, inv.currency);
  const half = (Number(inv.gstRate) / 2).toString();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/settings/billing" className="text-[13.5px] text-signal hover:underline">
          Billing
        </Link>
        <PrintButton>
          <Printer className="size-4" /> Save as PDF
        </PrintButton>
      </div>

      <article className="mx-auto max-w-3xl rounded-[var(--radius-panel)] border border-line bg-surface p-8 print:border-0 print:p-0">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-semibold tracking-[.08em]">SCALER</p>
            <h1 className="mt-2 text-[22px] font-semibold">{inv.testMode ? "Test invoice" : "Tax invoice"}</h1>
            {inv.testMode && (
              <p className="mt-1 text-[13px] text-danger">Not a tax invoice. Issued in test mode; no money was charged.</p>
            )}
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-[13.5px]">
            <dt className="text-muted">Invoice no.</dt>
            <dd className="font-medium">{inv.number}</dd>
            <dt className="text-muted">Date</dt>
            <dd>{formatDate(inv.issuedAt, tz)}</dd>
            <dt className="text-muted">Place of supply</dt>
            <dd>{inv.placeOfSupply ? `${stateName(inv.placeOfSupply)} (${inv.placeOfSupply})` : "Outside India"}</dd>
          </dl>
        </div>

        <div className="mb-8 grid gap-6 sm:grid-cols-2">
          <Party title="From" p={inv.seller} />
          <Party title="Billed to" p={inv.buyer} />
        </div>

        <table className="mb-6 w-full text-[13.5px]">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 font-medium">SAC</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <td className="py-3">
                {inv.description}
                {inv.periodStart && inv.periodEnd && (
                  <p className="text-[12.5px] text-muted">
                    {formatDate(inv.periodStart, tz)} to {formatDate(inv.periodEnd, tz)}
                  </p>
                )}
              </td>
              <td className="py-3">{inv.sacCode}</td>
              <td className="py-3 text-right tabular-nums">{money(inv.taxable)}</td>
            </tr>
          </tbody>
          <tfoot className="tabular-nums">
            {inv.supplyType === "intra_state" && (
              <>
                <tr>
                  <td colSpan={2} className="pt-3 text-right text-muted">CGST {half}%</td>
                  <td className="pt-3 text-right">{money(inv.cgst)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="text-right text-muted">SGST {half}%</td>
                  <td className="text-right">{money(inv.sgst)}</td>
                </tr>
              </>
            )}
            {inv.supplyType === "inter_state" && (
              <tr>
                <td colSpan={2} className="pt-3 text-right text-muted">IGST {inv.gstRate}%</td>
                <td className="pt-3 text-right">{money(inv.igst)}</td>
              </tr>
            )}
            <tr className="font-semibold">
              <td colSpan={2} className="pt-3 text-right">Total</td>
              <td className="pt-3 text-right">{money(inv.total)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="text-[12.5px] text-muted">
          {SUPPLY[inv.supplyType]}. Paid on {formatDate(inv.paidAt, tz)}, payment reference {inv.paymentId}. Tax is not payable on
          reverse charge.
        </p>
      </article>
    </>
  );
}
