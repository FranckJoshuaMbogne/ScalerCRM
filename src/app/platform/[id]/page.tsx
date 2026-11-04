import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, SubmitButton } from "@/components/ui/form";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { UsageBars } from "@/components/ui/usage-bars";
import { formatDateTime } from "@/lib/format";
import { LIMITS, usageRows } from "@/modules/plans/limits";
import { getPlatformBusiness, requirePlatformAdmin } from "@/modules/plans/platform";
import { setBusinessPlan, setBusinessStatus } from "@/modules/plans/platform-actions";
import { listPlans } from "@/modules/plans/queries";
import { getBusinessBilling } from "@/modules/billing/platform";

export const metadata = { title: "Business" };

export default async function PlatformBusinessPage(props: PageProps<"/platform/[id]">) {
  await requirePlatformAdmin();
  const { id } = await props.params;
  const [b, plans] = await Promise.all([getPlatformBusiness(id), listPlans()]);
  if (!b) notFound();
  const billing = await getBusinessBilling(id);
  const sub = billing.subscription as {
    status?: string;
    plan_key?: string;
    billing_interval?: string;
    current_period_end?: string;
    provider?: string;
    live?: boolean;
    grace_ends_at?: string;
  } | null;
  const tz = "Asia/Kolkata";

  return (
    <>
      <Link href="/platform" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Businesses
      </Link>
      <PageHeader
        title={b.name}
        description={`${b.slug} · since ${formatDateTime(b.createdAt, tz)} · ${b.status}${b.statusReason ? ` (${b.statusReason})` : ""}`}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Usage</h2>
          <UsageBars rows={usageRows(b.limits, b.usage)} />
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Plan</h2>
          <ActionForm action={setBusinessPlan} className="space-y-3">
            <input type="hidden" name="businessId" value={b.id} />
            <SelectField label="Plan" name="planKey" defaultValue={b.planKey} options={plans.map((p) => ({ value: p.key, label: p.name }))} />
            <p className="text-[12.5px] text-muted">Overrides: leave empty to use the plan&apos;s limit.</p>
            <div className="grid grid-cols-2 gap-3">
              {LIMITS.map((l) => (
                <Field
                  key={l.key}
                  label={l.label}
                  name={`override_${l.key}`}
                  inputMode="numeric"
                  defaultValue={b.planOverrides[l.key] != null ? String(b.planOverrides[l.key]) : ""}
                />
              ))}
            </div>
            <Field label="Trial ends (optional)" name="trialEndsAt" type="date" defaultValue={b.trialEndsAt?.slice(0, 10) ?? ""} />
            <Field label="Reason" name="reason" required maxLength={300} hint="Kept in the business's plan history." />
            <SubmitButton pendingLabel="Saving…">Save plan</SubmitButton>
          </ActionForm>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-1 text-[15px] font-semibold">{b.status === "suspended" ? "Reactivate" : "Suspend"}</h2>
          <p className="mb-4 text-[13.5px] text-muted">
            {b.status === "suspended"
              ? "The business is read-only. Reactivating lets its team make changes again."
              : "Suspending makes the business read-only: its team can still sign in, view and export, but not change anything."}
          </p>
          <ActionForm action={setBusinessStatus} className="space-y-3">
            <input type="hidden" name="businessId" value={b.id} />
            <input type="hidden" name="status" value={b.status === "suspended" ? "active" : "suspended"} />
            <Field label="Reason" name="reason" required maxLength={300} hint="Shown to the business when suspending." />
            <SubmitButton variant={b.status === "suspended" ? "primary" : "danger"} pendingLabel="Saving…">
              {b.status === "suspended" ? "Reactivate business" : "Suspend business"}
            </SubmitButton>
          </ActionForm>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-3 text-[15px] font-semibold">Health</h2>
          <ul className="space-y-1.5 text-[13.5px]">
            {b.health.whatsapp.length === 0 && <li className="text-muted">No WhatsApp number connected</li>}
            {b.health.whatsapp.map((w) => (
              <li key={w.display}>
                WhatsApp {w.display}: <span className={w.status === "connected" ? "" : "text-danger"}>{w.status}</span>
              </li>
            ))}
            <li>Failed webhook events (24 h): {b.health.webhook_failures_24h}</li>
            <li>Failed automation runs (7 days): {b.health.automation_failures_7d}</li>
            <li>Ad accounts with errors: {b.health.ad_account_errors}</li>
          </ul>
          <p className="mt-4 text-[13.5px]">
            {b.supportUntil
              ? `Support access is open until ${formatDateTime(b.supportUntil, tz)}: switch to this business from the business menu to view it.`
              : "No support access. The business admin can allow it under Settings → Plan and usage."}
          </p>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-3 text-[15px] font-semibold">Team ({b.members.length})</h2>
          <ul className="space-y-1 text-[13.5px]">
            {b.members.map((m) => (
              <li key={m.email}>
                {m.name ?? m.email} <span className="text-muted">· {m.role}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-3 text-[15px] font-semibold">Billing</h2>
          {sub ? (
            <p className="mb-3 text-[13.5px]">
              <span className="font-medium">{sub.status?.replace("_", " ")}</span>
              {sub.plan_key ? ` · ${sub.plan_key}, ${sub.billing_interval ?? ""}` : ""}
              {sub.provider ? ` · ${sub.provider}${sub.live ? "" : " (test)"}` : ""}
              {sub.current_period_end ? ` · renews ${formatDateTime(sub.current_period_end, tz)}` : ""}
              {sub.grace_ends_at ? ` · grace until ${formatDateTime(sub.grace_ends_at, tz)}` : ""}
            </p>
          ) : (
            <p className="mb-3 text-[13.5px] text-muted">No subscription: billed by hand.</p>
          )}
          <ul className="mb-3 space-y-1 text-[13.5px]">
            {billing.history.map((h) => (
              <li key={h.created_at + h.to_status}>
                {h.from_status ?? "—"} → <span className="font-medium">{h.to_status}</span>{" "}
                <span className="text-muted">
                  · {h.reason} · {formatDateTime(h.created_at, tz)}
                </span>
              </li>
            ))}
          </ul>
          {billing.invoices.length > 0 && (
            <p className="text-[13.5px] text-muted">
              Invoices: {billing.invoices.map((i) => `${i.number} (${i.total}${i.test_mode ? ", test" : ""})`).join(", ")}
            </p>
          )}
          {billing.events.some((e) => e.error) && (
            <p className="mt-2 text-[13.5px] text-danger">Some webhooks for this business were not applied. See Platform → Billing.</p>
          )}
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-3 text-[15px] font-semibold">History</h2>
          <ul className="space-y-2 text-[13.5px]">
            {b.history.map((h) => (
              <li key={h.at}>
                <span className="font-medium">
                  {h.plan_key} · {h.status}
                </span>
                {Object.keys(h.overrides ?? {}).length > 0 && (
                  <span className="text-muted"> · overrides {Object.entries(h.overrides).map(([k, v]) => `${k} ${v}`).join(", ")}</span>
                )}
                <p className="text-muted">
                  {formatDateTime(h.at, tz)}
                  {h.by ? ` · ${h.by}` : ""}
                  {h.reason ? ` · ${h.reason}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
