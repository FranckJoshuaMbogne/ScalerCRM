import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getBusinessPlan } from "@/modules/plans/queries";
import { can, getContext } from "@/modules/tenancy/session";

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

  if (business.status === "suspended") {
    const plan = await getBusinessPlan(business.businessId);
    return (
      <div role="alert" className={`${box} border-danger/40 bg-danger/10`}>
        <span className="font-medium">{business.businessName} is suspended.</span> You can view and export your data, but nothing
        can be changed until it&apos;s reactivated{plan.statusReason ? ` (${plan.statusReason})` : ""}. Contact Springs 360 to
        reactivate it.
      </div>
    );
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
