import { ActionForm } from "@/components/ui/action-form";
import { Field, SubmitButton } from "@/components/ui/form";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { LIMITS } from "@/modules/plans/limits";
import { requirePlatformAdmin } from "@/modules/plans/platform";
import { savePlan } from "@/modules/plans/platform-actions";
import { listPlans } from "@/modules/plans/queries";

export const metadata = { title: "Plans" };

export default async function PlansPage() {
  await requirePlatformAdmin();
  const plans = await listPlans();
  return (
    <>
      <PageHeader
        title="Plans"
        description="Limits apply to every business on the plan at once, except where a business has an override. Leave a limit empty for unlimited."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {plans.map((p) => (
          <Panel key={p.key} className="p-5">
            <ActionForm action={savePlan} className="space-y-3">
              <input type="hidden" name="key" value={p.key} />
              <div className="flex items-baseline justify-between">
                <h2 className="text-[15px] font-semibold">{p.name}</h2>
                <span className="text-[12.5px] text-muted">{p.key}</span>
              </div>
              <Field label="Name" name="name" defaultValue={p.name} required />
              <Field label="Description" name="description" defaultValue={p.description ?? ""} />
              <div className="grid grid-cols-2 gap-3">
                {LIMITS.map((l) => (
                  <Field key={l.key} label={l.label} name={l.key} inputMode="numeric" defaultValue={p.limits[l.key]?.toString() ?? ""} />
                ))}
                <Field label={`Price a month (${p.currency})`} name="priceMonthly" inputMode="decimal" defaultValue={p.priceMonthly ?? ""} />
                <Field label={`Price a year (${p.currency})`} name="priceYearly" inputMode="decimal" defaultValue={p.priceYearly ?? ""} />
              </div>
              <label className="flex items-center gap-2 text-[13.5px]">
                <input type="checkbox" name="isPublic" defaultChecked={p.isPublic} /> Offered to new businesses
              </label>
              <SubmitButton pendingLabel="Saving…">Save {p.name}</SubmitButton>
            </ActionForm>
          </Panel>
        ))}
      </div>
    </>
  );
}
