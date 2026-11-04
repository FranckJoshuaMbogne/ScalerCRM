import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getBusinessPlan } from "@/modules/plans/queries";
import { can, getContext } from "@/modules/tenancy/session";

/** True when the time is less than `days` days away. */
function endsWithinDays(iso: string, days: number) {
  return new Date(iso).getTime() - new Date().getTime() < days * 86_400_000;
}

const box = "mb-6 rounded-[var(--radius-panel)] border px-4 py-3 text-[13.5px]";

/** Read-only states the whole workspace should know about. */
export async function StatusBanner() {
  const ctx = await getContext();
  const { business } = ctx;
  const tz = business.timezone;

  if (business.support) {
    return (
      <div role="status" className={`${box} border-stage-negotiation/40 bg-stage-negotiation/10`}>
        You&apos;re viewing <span className="font-medium">{business.businessName}</span> as SCALER support, read-only, until{" "}
        {formatDateTime(business.support.until, tz)}. <Link href="/platform" className="text-signal hover:underline">Platform console</Link>
      </div>
    );
  }

  const plan = await getBusinessPlan(business.businessId);
  const payLink = can(ctx, "billing.manage") ? (
    <Link href="/settings/billing" className="font-medium text-signal hover:underline">
      Pay now
    </Link>
  ) : (
    "Ask your business admin to pay."
  );

  if (business.status === "suspended") {
    if (plan.suspendedBy === "billing") {
      return (
        <div role="alert" className={`${box} border-danger/40 bg-danger/10`}>
          <span className="font-medium">{business.businessName} is read-only</span>{" "}
          {plan.billingStatus === "cancelled" ? "because the subscription ended." : "because the payment is overdue."} You can view and
          export everything; paying restores full access at once. {payLink}
        </div>
      );
    }
    return (
      <div role="alert" className={`${box} border-danger/40 bg-danger/10`}>
        <span className="font-medium">{business.businessName} is suspended.</span> You can view and export your data, but nothing
        can be changed until it&apos;s reactivated{plan.statusReason ? ` (${plan.statusReason})` : ""}. Contact Springs 360 to
        reactivate it.
      </div>
    );
  }

  if ((plan.billingStatus === "past_due" || plan.billingStatus === "grace") && plan.graceEndsAt) {
    return (
      <div role="alert" className={`${box} border-danger/40 bg-danger/10`}>
        {plan.billingStatus === "past_due" ? "The last payment didn't go through." : "Payment is due."} Pay by{" "}
        {formatDateTime(plan.graceEndsAt, tz)} to keep {business.businessName} working normally. {payLink}
      </div>
    );
  }

  if (plan.billingStatus === "trialing" && plan.trialEndsAt && can(ctx, "billing.manage")) {
    if (endsWithinDays(plan.trialEndsAt, 3)) {
      return (
        <div role="status" className={`${box} border-line bg-surface`}>
          Your free trial ends {formatDateTime(plan.trialEndsAt, tz)}.{" "}
          <Link href="/settings/billing" className="font-medium text-signal hover:underline">
            Choose a plan
          </Link>
        </div>
      );
    }
  }

  if (can(ctx, "settings.business.manage")) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("support_access_grants")
      .select("expires_at")
      .eq("business_id", business.businessId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      return (
        <div role="status" className={`${box} border-line bg-surface`}>
          SCALER support can view this business until {formatDateTime(data.expires_at, tz)}.{" "}
          <Link href="/settings/plan" className="text-signal hover:underline">
            End access
          </Link>
        </div>
      );
    }
  }
  return null;
}
