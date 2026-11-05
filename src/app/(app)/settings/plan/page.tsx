import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { UsageBars } from "@/components/ui/usage-bars";
import { formatDateTime } from "@/lib/format";
import { grantSupportAccess, revokeSupportAccess } from "@/modules/plans/actions";
import { usageRows } from "@/modules/plans/limits";
import { getBusinessPlan } from "@/modules/plans/queries";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Plan and usage" };

export default async function PlanPage() {
  const ctx = await getContext();
  if (!can(ctx, "settings.business.manage")) return <NoAccess what="the plan" />;
  const plan = await getBusinessPlan(ctx.business.businessId);
  const tz = ctx.business.timezone;

  return (
    <>
      <Link href="/settings" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Settings
      </Link>
      <PageHeader
        title="Plan and usage"
        description="What your plan includes and how much of it you're using. To change plan, contact Springs 360."
      />

      <Panel className="mb-6 p-5">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold">{plan.planName} plan</h2>
          {plan.trialEndsAt && (
            <p className="text-[13.5px] text-muted">Trial until {formatDateTime(plan.trialEndsAt, tz)}</p>
          )}
        </div>
        <UsageBars rows={usageRows(plan.limits, plan.usage)} />
        <p className="mt-5 text-[13px] text-muted">
          Limits are checked when something is added: a new user, branch, WhatsApp number, active automation or campaign.
          Nothing you already have is removed if you go over.
        </p>
      </Panel>

      <Panel className="p-5">
        <h2 className="mb-1 text-[15px] font-semibold">SCALER support access</h2>
        <p className="mb-4 text-[13.5px] text-muted">
          Let SCALER support see your business to help with a problem. They can only view, never change or export, and access
          ends automatically. Every grant is in the audit log.
        </p>
        {plan.supportUntil ? (
          <ActionForm action={revokeSupportAccess} className="flex flex-wrap items-center gap-3">
            <p className="text-[14px]">
              Support can view your business until <span className="font-medium">{formatDateTime(plan.supportUntil, tz)}</span>.
            </p>
            <SubmitButton variant="danger" pendingLabel="Ending…">
              End access now
            </SubmitButton>
          </ActionForm>
        ) : (
          <ActionForm action={grantSupportAccess} className="flex flex-wrap items-end gap-3">
            <SelectField
              label="For"
              name="hours"
              defaultValue="24"
              className="w-40"
              options={[
                { value: "4", label: "4 hours" },
                { value: "24", label: "24 hours" },
                { value: "72", label: "3 days" },
              ]}
            />
            <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <span className="text-[13px] font-medium">What should they look at? (optional)</span>
              <input
                name="reason"
                maxLength={300}
                className="h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[14px]"
              />
            </label>
            <SubmitButton pendingLabel="Allowing…">Allow support access</SubmitButton>
          </ActionForm>
        )}
      </Panel>
    </>
  );
}
