import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { fakeCheckout } from "@/modules/billing/actions";
import { billingProvider } from "@/modules/billing/provider";
import { getQuote, getSubscription } from "@/modules/billing/queries";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Test checkout" };
export const maxDuration = 30;

/** The fake provider's checkout. Exists only when the test payment provider is configured. */
export default async function TestCheckoutPage() {
  if (billingProvider()?.name !== "fake") notFound();
  const ctx = await getContext();
  if (!can(ctx, "billing.manage")) notFound();
  const sub = await getSubscription(ctx.business.businessId);
  if (!sub?.checkoutPlanKey) notFound();
  const interval = sub.checkoutInterval ?? "monthly";
  const q = await getQuote(ctx.business.businessId, sub.checkoutPlanKey, interval);
  const name = "error" in q ? sub.checkoutPlanKey : q.planName;

  return (
    <>
      <PageHeader title="Test checkout" description="This page stands in for the payment provider's checkout. No money moves." />
      <Panel className="max-w-lg p-5">
        <p className="mb-4 text-[14px]">
          Subscribe <span className="font-medium">{ctx.business.businessName}</span> to <span className="font-medium">{name}</span>
          {!("error" in q) && ` for ${formatMoney(q.chargeAmount, q.currency)} a ${interval === "yearly" ? "year" : "month"}, GST included`}.
        </p>
        <div className="flex flex-wrap gap-3">
          <ActionForm action={fakeCheckout}>
            <input type="hidden" name="outcome" value="pay" />
            <SubmitButton pendingLabel="Paying…">Pay (test)</SubmitButton>
          </ActionForm>
          <ActionForm action={fakeCheckout}>
            <input type="hidden" name="outcome" value="fail" />
            <SubmitButton variant="secondary" pendingLabel="…">
              Payment fails
            </SubmitButton>
          </ActionForm>
          <Link href="/settings/billing" className="self-center text-[13.5px] text-muted hover:underline">
            Back to billing
          </Link>
        </div>
      </Panel>
    </>
  );
}
