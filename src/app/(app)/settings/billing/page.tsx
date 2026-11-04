import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { cancelSubscription, changePlan, fakeSimulate, startCheckout } from "@/modules/billing/actions";
import { billingProvider } from "@/modules/billing/provider";
import { getBillingProfile, getQuote, getSubscription, listInvoices, type Quote, type Subscription } from "@/modules/billing/queries";
import { LIMITS } from "@/modules/plans/limits";
import { getBusinessPlan, listPlans } from "@/modules/plans/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { BillingProfileForm } from "./billing-forms";

export const metadata = { title: "Billing" };
export const maxDuration = 30;

const STATUS: Record<Subscription["status"], { label: string; tone: string }> = {
  trialing: { label: "Not subscribed yet", tone: "text-muted" },
  active: { label: "Active", tone: "text-stage-won" },
  past_due: { label: "Payment failed, retrying", tone: "text-danger" },
  grace: { label: "Payment due", tone: "text-danger" },
  read_only: { label: "Read-only until paid", tone: "text-danger" },
  cancelled: { label: "Cancelled", tone: "text-muted" },
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const per = (i: string) => (i === "yearly" ? "year" : "month");

function QuoteBox({ q, tz }: { q: Quote; tz: string }) {
  const money = (v: string) => formatMoney(v, q.currency);
  const blocked = q.blockers.length > 0;
  const label = (key: string) => LIMITS.find((l) => l.key === key)?.label ?? key;
  return (
    <Panel className="mb-6 border-signal/40 p-5">
      <h2 className="mb-1 text-[15px] font-semibold">
        {q.planName}, {q.interval}
      </h2>
      <p className="mb-4 text-[14px]">
        {money(q.price)} a {per(q.interval)} + {q.gstRate}% GST = <span className="font-semibold">{money(q.chargeAmount)}</span> a{" "}
        {per(q.interval)}.
      </p>
      {q.effective === "same" && <p className="text-[14px] text-muted">This is already your plan.</p>}
      {q.effective === "now" && (
        <p className="mb-4 text-[14px]">
          The upgrade applies at once. {money(q.prorationAmount)} for the rest of this period is added to your next payment
          {q.renewsAt ? ` on ${formatDate(q.renewsAt, tz)}` : ""}.
        </p>
      )}
      {q.effective === "renewal" && !blocked && (
        <p className="mb-4 text-[14px]">
          You keep your current plan until {q.renewsAt ? formatDate(q.renewsAt, tz) : "the next renewal"}, then move to {q.planName}.
        </p>
      )}
      {blocked && (
        <div role="alert" className="mb-4 rounded-[var(--radius-control)] border border-danger/40 bg-danger/10 p-3 text-[13.5px]">
          <p className="mb-1 font-medium">Your business uses more than {q.planName} allows:</p>
          <ul className="list-inside list-disc">
            {q.blockers.map((b) => (
              <li key={b.key}>
                {label(b.key)}: you use {b.uses}, {q.planName} allows {b.allows}
              </li>
            ))}
          </ul>
          <p className="mt-1">Remove what&apos;s over the limit first, or choose a bigger plan.</p>
        </div>
      )}
      {!blocked && q.effective !== "same" && (
        <ActionForm action={q.effective === "checkout" ? startCheckout : changePlan} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="plan" value={q.planKey} />
          <input type="hidden" name="interval" value={q.interval} />
          <SubmitButton pendingLabel="Opening…">
            {q.effective === "checkout" ? `Pay ${money(q.chargeAmount)}` : q.effective === "now" ? "Upgrade now" : "Change at renewal"}
          </SubmitButton>
          <Link href="/settings/billing" className="text-[13.5px] text-muted hover:underline">
            Not now
          </Link>
          {q.effective === "checkout" && (
            <p className="basis-full text-[12.5px] text-muted">
              Pay by UPI autopay, card or net banking. It renews every {per(q.interval)} until you cancel.
            </p>
          )}
        </ActionForm>
      )}
    </Panel>
  );
}

export default async function BillingPage({ searchParams }: PageProps<"/settings/billing">) {
  const ctx = await getContext();
  if (!can(ctx, "billing.manage")) return <NoAccess what="billing" />;
  const businessId = ctx.business.businessId;
  const tz = ctx.business.timezone;
  const sp = await searchParams;
  const [plan, plans, sub, profile, invoices] = await Promise.all([
    getBusinessPlan(businessId),
    listPlans(),
    getSubscription(businessId),
    getBillingProfile(businessId),
    listInvoices(businessId),
  ]);
  const provider = billingProvider();
  const chosen = one(sp.plan);
  const chosenInterval = one(sp.interval) === "yearly" ? "yearly" : "monthly";
  const quote = chosen ? await getQuote(businessId, chosen, chosenInterval) : null;
  const onSale = plans.filter((p) => p.isPublic && (p.priceMonthly || p.priceYearly));
  const status = sub ? STATUS[sub.status] : null;
  const paying = sub && ["active", "past_due"].includes(sub.status) && sub.providerSubscriptionId;
  const testMode = provider?.name === "fake" || (provider && !provider.live);

  return (
    <>
      <Link href="/settings" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Settings
      </Link>
      <PageHeader
        title="Billing"
        description="Your SCALER subscription, billing details and invoices."
        actions={
          <Link href="/settings/plan" className={linkButton.secondary}>
            Plan and usage
          </Link>
        }
      />

      {one(sp.paid) && (
        <div role="status" className="mb-6 rounded-[var(--radius-panel)] border border-stage-won/40 bg-stage-won/10 px-4 py-3 text-[13.5px]">
          Payment received. Your invoice is below and on its way by email.
        </div>
      )}
      {testMode && (
        <p className="mb-4 text-[13px] text-muted">
          Test mode: no money is charged and invoices are marked as test invoices.
        </p>
      )}

      <Panel className="mb-6 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold">
            {plan.planName} plan{sub?.interval ? `, ${sub.interval}` : ""}
          </h2>
          {status && <p className={`text-[14px] font-medium ${status.tone}`}>{status.label}</p>}
        </div>
        <ul className="mt-3 space-y-1.5 text-[14px]">
          {!sub && !plan.trialEndsAt && <li className="text-muted">Billed by Springs 360 directly. You can also pay online below.</li>}
          {plan.trialEndsAt && <li>Free trial until {formatDate(plan.trialEndsAt, tz)}.</li>}
          {sub?.status === "active" && sub.currentPeriodEnd && (
            <li>
              {sub.cancelAtPeriodEnd
                ? `Cancelled: everything keeps working until ${formatDate(sub.currentPeriodEnd, tz)}, then the business becomes read-only.`
                : `Next payment on ${formatDate(sub.currentPeriodEnd, tz)}.`}
            </li>
          )}
          {sub?.pendingPlanKey && (
            <li>
              Moving to {plans.find((p) => p.key === sub.pendingPlanKey)?.name ?? sub.pendingPlanKey} at the next renewal.
            </li>
          )}
          {(sub?.status === "past_due" || sub?.status === "grace") && sub.graceEndsAt && (
            <li className="text-danger">
              The last payment didn&apos;t go through. Pay by {formatDate(sub.graceEndsAt, tz)} to avoid the business becoming
              read-only.
            </li>
          )}
          {(sub?.status === "read_only" || sub?.status === "cancelled") && (
            <li>
              Your team can view and export everything, but not change anything, until you pay. Nothing is deleted.
            </li>
          )}
          {sub?.paymentMethod && <li className="text-muted">Paying with {sub.paymentMethod.label}.</li>}
        </ul>
      </Panel>

      {quote && "error" in quote && (
        <p role="alert" className="mb-6 text-[14px] text-danger">
          That plan isn&apos;t available to buy online.
        </p>
      )}
      {quote && !("error" in quote) && <QuoteBox q={quote} tz={tz} />}

      {!provider ? (
        <Panel className="mb-6 p-5 text-[14px] text-muted">
          Online payment isn&apos;t set up yet. Contact Springs 360 to change your plan.
        </Panel>
      ) : onSale.length === 0 ? (
        <Panel className="mb-6 p-5 text-[14px] text-muted">Plans aren&apos;t priced yet. Contact Springs 360 to subscribe.</Panel>
      ) : (
        <Panel className="mb-6">
          <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">
            {paying ? "Change plan" : "Choose a plan"}
          </h2>
          <ul className="grid gap-px bg-line sm:grid-cols-3">
            {onSale.map((p) => (
              <li key={p.key} className="flex flex-col gap-2 bg-surface p-5">
                <p className="text-[15px] font-semibold">
                  {p.name}
                  {p.key === plan.planKey && <span className="ml-2 text-[12.5px] font-normal text-muted">current</span>}
                </p>
                {p.description && <p className="text-[13px] text-muted">{p.description}</p>}
                <p className="text-[13px] text-muted">
                  {p.limits.max_users ?? "Unlimited"} users · {p.limits.max_branches ?? "Unlimited"} branches ·{" "}
                  {p.limits.monthly_messages?.toLocaleString("en-IN") ?? "Unlimited"} messages a month
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  {p.priceMonthly && (
                    <Link href={`/settings/billing?plan=${p.key}&interval=monthly`} className={linkButton.secondary}>
                      {formatMoney(p.priceMonthly, p.currency)}/month
                    </Link>
                  )}
                  {p.priceYearly && (
                    <Link href={`/settings/billing?plan=${p.key}&interval=yearly`} className={linkButton.secondary}>
                      {formatMoney(p.priceYearly, p.currency)}/year
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-5 py-3 text-[12.5px] text-muted">Prices are before GST (18%).</p>
        </Panel>
      )}

      <Panel className="mb-6 p-5">
        <h2 className="mb-1 text-[15px] font-semibold">Billing details</h2>
        <p className="mb-4 text-[13.5px] text-muted">Printed on your invoices. Invoices go to the invoice email.</p>
        <BillingProfileForm profile={profile} fallbackName={ctx.business.businessName} />
      </Panel>

      <Panel className="mb-6">
        <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="px-5 py-6 text-[14px] text-muted">No invoices yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-5 py-3 text-[13.5px]">
                <Link href={`/settings/billing/invoices/${i.id}`} className="w-40 font-medium text-signal hover:underline">
                  {i.number}
                </Link>
                <span className="w-28 text-muted">{formatDate(i.issuedAt, tz)}</span>
                <span className="flex-1">
                  {i.description}
                  {i.testMode && <span className="ml-2 text-[12px] text-muted">(test)</span>}
                </span>
                <span className="tabular-nums">{formatMoney(i.total, i.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {paying && !sub.cancelAtPeriodEnd && (
        <Panel className="mb-6 p-5">
          <h2 className="mb-1 text-[15px] font-semibold">Cancel subscription</h2>
          <p className="mb-4 text-[13.5px] text-muted">
            It stops renewing. Everything keeps working until the period ends; then the business is read-only and its data is kept.
          </p>
          <ActionForm action={cancelSubscription} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Type &quot;cancel&quot; to confirm</span>
              <input
                name="confirm"
                autoComplete="off"
                className="h-10 w-48 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[14px]"
              />
            </label>
            <SubmitButton variant="danger" pendingLabel="Cancelling…">
              Cancel subscription
            </SubmitButton>
          </ActionForm>
        </Panel>
      )}

      {provider?.name === "fake" && sub?.provider === "fake" && sub.providerSubscriptionId && (
        <Panel className="border-dashed p-5">
          <h2 className="mb-1 text-[15px] font-semibold">Test controls</h2>
          <p className="mb-4 text-[13.5px] text-muted">
            Play the payment provider&apos;s part to try every state. Only shown with the test payment provider.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              ["renewal", "Renewal paid"],
              ["failed", "Renewal failed"],
              ["halted", "Retries exhausted"],
              ["end_grace", "End the grace period"],
              ["cancelled", "Provider cancels"],
            ].map(([value, label]) => (
              <ActionForm key={value} action={fakeSimulate}>
                <input type="hidden" name="simulate" value={value} />
                <SubmitButton variant="secondary" pendingLabel="…">
                  {label}
                </SubmitButton>
              </ActionForm>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
