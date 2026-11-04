import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SubmitButton } from "@/components/ui/form";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { getPlatformBilling } from "@/modules/billing/platform";
import { reconcileSettlement, saveSeller } from "@/modules/billing/platform-actions";
import { requirePlatformAdmin } from "@/modules/plans/platform";

export const metadata = { title: "Billing" };
export const maxDuration = 30;

const STATUSES = ["trialing", "active", "past_due", "grace", "read_only", "cancelled"];

export default async function PlatformBillingPage() {
  await requirePlatformAdmin();
  const b = await getPlatformBilling();
  const tz = "Asia/Kolkata";

  return (
    <>
      <PageHeader title="Billing" description="Subscriptions, invoices, webhook health and Springs 360's invoice details." />

      <Panel className="mb-6 p-5">
        <h2 className="mb-3 text-[15px] font-semibold">Subscriptions</h2>
        <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {STATUSES.map((s) => (
            <div key={s}>
              <dt className="text-[12.5px] text-muted">{s.replace("_", " ")}</dt>
              <dd className="text-[20px] font-semibold tabular-nums">{b.byStatus[s] ?? 0}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="mb-1 text-[15px] font-semibold">Seller details</h2>
          <p className="mb-4 text-[13.5px] text-muted">
            {b.sellerReady
              ? "Live payments get tax invoices with these details."
              : "Until the legal name, GSTIN and address are set, every invoice is a test invoice on its own series."}
          </p>
          <ActionForm action={saveSeller} className="grid gap-3 sm:grid-cols-2">
            <Field label="Legal name" name="legal_name" defaultValue={b.seller.legal_name ?? ""} className="sm:col-span-2" />
            <Field label="GSTIN" name="gstin" defaultValue={b.seller.gstin ?? ""} hint="Sets the state." />
            <Field label="Invoice email" name="email" type="email" defaultValue={b.seller.email ?? ""} />
            <Field label="Address" name="address" defaultValue={b.seller.address ?? ""} className="sm:col-span-2" />
            <Field label="Invoice prefix" name="invoice_prefix" defaultValue={b.seller.invoice_prefix} maxLength={4} hint="2–4 letters, e.g. SCL/27-28/00001." />
            <Field label="SAC code" name="sac_code" defaultValue={b.seller.sac_code} maxLength={6} hint={`GST rate ${b.seller.gst_rate}%.`} />
            <div className="sm:col-span-2">
              <SubmitButton pendingLabel="Saving…">Save seller details</SubmitButton>
            </div>
          </ActionForm>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-1 text-[15px] font-semibold">Reconcile a settlement</h2>
          <p className="mb-4 text-[13.5px] text-muted">
            Upload Razorpay&apos;s settlement reconciliation report (CSV). Every payment in it is matched to its invoice by payment id
            and amount.
          </p>
          <ActionForm action={reconcileSettlement} className="flex flex-col gap-3">
            <input type="hidden" name="provider" value="razorpay" />
            <input type="file" name="file" accept=".csv,text/csv" className="text-[13.5px]" />
            <div>
              <SubmitButton pendingLabel="Checking…">Check report</SubmitButton>
            </div>
          </ActionForm>
          <h3 className="mt-6 mb-2 text-[14px] font-semibold">Payments and invoices</h3>
          {b.unreconciled.length === 0 ? (
            <p className="text-[13.5px] text-muted">Every payment the provider reported has a matching invoice.</p>
          ) : (
            <ul className="space-y-1 text-[13.5px]">
              {b.unreconciled.map((u) => (
                <li key={`${u.provider}-${u.payment_id}`} className="text-danger">
                  {u.payment_id}: {u.problem} (paid {u.paid ?? "—"}, invoiced {u.invoiced ?? "—"})
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-3 text-[15px] font-semibold">Webhooks not applied</h2>
          {b.failedEvents.length === 0 ? (
            <p className="text-[13.5px] text-muted">None.</p>
          ) : (
            <ul className="space-y-2 text-[13.5px]">
              {b.failedEvents.map((e) => (
                <li key={e.id}>
                  <span className="font-medium">{e.event_type}</span> · {formatDateTime(e.received_at, tz)}
                  {e.business_id && (
                    <>
                      {" "}
                      · <Link href={`/platform/${e.business_id}`} className="text-signal hover:underline">business</Link>
                    </>
                  )}
                  <p className="text-danger">{e.error}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-1 text-[15px] font-semibold">Read-only for 90 days or more</h2>
          <p className="mb-3 text-[13.5px] text-muted">
            Nothing is deleted automatically. Decide with the business what happens to its data (see the retention runbook).
          </p>
          {b.longReadOnly.length === 0 ? (
            <p className="text-[13.5px] text-muted">None.</p>
          ) : (
            <ul className="space-y-1 text-[13.5px]">
              {b.longReadOnly.map((r) => (
                <li key={r.business_id}>
                  <Link href={`/platform/${r.business_id}`} className="text-signal hover:underline">
                    {r.name}
                  </Link>{" "}
                  <span className="text-muted">since {formatDateTime(r.since, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
