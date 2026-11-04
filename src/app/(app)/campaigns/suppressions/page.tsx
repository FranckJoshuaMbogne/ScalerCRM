import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime, formatPhone } from "@/lib/format";
import { addSuppression, removeSuppression } from "@/modules/campaigns/actions";
import { listSuppressions } from "@/modules/campaigns/queries";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Suppression list" };

const REASON: Record<string, string> = {
  opt_out: "Opted out (replied STOP)",
  blocked_marketing: "Blocked marketing in WhatsApp",
  undeliverable: "Not on WhatsApp",
  manual: "Added by staff",
};

export default async function SuppressionsPage() {
  const ctx = await getContext();
  if (!can(ctx, "campaigns.manage") && !can(ctx, "campaigns.view")) return <NoAccess what="the suppression list" />;
  const list = await listSuppressions(ctx.business.businessId);
  const manage = can(ctx, "campaigns.manage");
  return (
    <>
      <Link href="/campaigns" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Campaigns</Link>
      <PageHeader title="Suppression list" description="Numbers that never receive campaigns, whatever their consent record says." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Panel>
          {list.length === 0 ? (
            <EmptyState title="Nobody is suppressed" />
          ) : (
            <ul className="divide-y divide-line">
              {list.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13.5px]">
                  <span className="w-40 tabular-nums">{formatPhone(s.phone)}</span>
                  <span className="flex-1">{REASON[s.reason] ?? s.reason}{s.note ? <span className="text-muted"> · {s.note}</span> : null}</span>
                  <span className="text-[12px] text-muted">{formatDateTime(s.createdAt, ctx.business.timezone)}</span>
                  {manage && (s.reason === "manual" || s.reason === "undeliverable") && (
                    <ActionForm action={removeSuppression}>
                      <input type="hidden" name="id" value={s.id} />
                      <SubmitButton variant="ghost">Remove</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {manage && (
          <Panel className="h-fit p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Add a number</h2>
            <ActionForm action={addSuppression} className="flex flex-col gap-3">
              <Field label="Phone" name="phone" type="tel" inputMode="tel" required />
              <Field label="Note" name="note" placeholder="Asked in store not to be messaged" />
              <div><SubmitButton variant="secondary">Suppress</SubmitButton></div>
            </ActionForm>
            <p className="mt-3 text-[12.5px] text-muted">Opt-outs are lifted only when the customer replies START.</p>
          </Panel>
        )}
      </div>
    </>
  );
}
