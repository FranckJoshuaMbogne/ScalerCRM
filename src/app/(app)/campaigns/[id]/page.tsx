import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { changeCampaignState, duplicateCampaign, launchCampaign, testSend } from "@/modules/campaigns/actions";
import { getCampaign, getReport, listCampaignEvents, listFailures, listTemplates } from "@/modules/campaigns/queries";
import { toLocalInput } from "@/modules/tasks/schedule";
import { can, getContext } from "@/modules/tenancy/session";
import { CampaignForm } from "../campaign-forms";
import { builderOptions } from "../data";
import { CampaignStatus } from "../status";

export const metadata = { title: "Campaign" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT: Record<string, string> = {
  started: "Started sending", scheduled: "Scheduled", completed: "Finished", paused: "Paused", resumed: "Resumed",
  cancelled: "Cancelled", unscheduled: "Moved back to draft", test_sent: "Test sent", test_failed: "Test failed",
};

function pct(n: number, of: number) {
  return of ? `${Math.round((n / of) * 100)}%` : "—";
}

export default async function CampaignPage({ params }: PageProps<"/campaigns/[id]">) {
  const ctx = await getContext();
  if (!can(ctx, "campaigns.view") && !can(ctx, "campaigns.manage")) return <NoAccess what="campaigns" />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  const tz = ctx.business.timezone;
  const [report, events, failures, templates] = await Promise.all([getReport(id), listCampaignEvents(id), listFailures(id), listTemplates(ctx.business.businessId)]);
  const template = templates.find((t) => t.id === campaign.templateId);
  const draft = campaign.status === "draft";
  const canSend = can(ctx, "campaigns.send");
  const r = report ?? { recipients: 0, pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, replied: 0, leads: 0, orders: 0, revenue: "0" };

  return (
    <>
      <Link href="/campaigns" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Campaigns</Link>
      <PageHeader
        title={campaign.name}
        description={template ? `Template ${template.name} (${template.language})` : undefined}
        actions={<CampaignStatus status={campaign.status} />}
      />

      {draft ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <Panel className="p-5">
            {can(ctx, "campaigns.manage") ? <CampaignForm campaign={campaign} {...await builderOptions(ctx.business.businessId)} /> : <p className="text-muted">Draft.</p>}
          </Panel>
          <div className="flex flex-col gap-6">
            {can(ctx, "campaigns.manage") && (
              <Panel className="p-5">
                <h2 className="mb-1 text-[15px] font-semibold">Send a test</h2>
                <p className="mb-3 text-[13px] text-muted">To your own WhatsApp. It isn&apos;t counted in the report.</p>
                <ActionForm action={testSend} className="flex flex-col gap-3">
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <Field label="Phone" name="phone" type="tel" inputMode="tel" required placeholder="98490 12345" />
                  <div><SubmitButton variant="secondary" pendingLabel="Sending…">Send test</SubmitButton></div>
                </ActionForm>
              </Panel>
            )}
            {canSend && (
              <Panel className="p-5">
                <h2 className="mb-1 text-[15px] font-semibold">Launch</h2>
                <p className="mb-3 text-[13px] text-muted">Leave the time empty to start now. Recipients are chosen when sending starts.</p>
                <ActionForm action={launchCampaign} className="flex flex-col gap-3">
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <Field label="Schedule for (optional)" name="scheduleAt" type="datetime-local" min={toLocalInput(new Date(), tz)} />
                  <div><SubmitButton pendingLabel="Launching…">Launch campaign</SubmitButton></div>
                </ActionForm>
              </Panel>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Panel className="grid grid-cols-2 divide-line tabular-nums sm:grid-cols-4 sm:divide-x">
              {[
                { label: "Sent", value: r.sent, note: `of ${r.recipients}${r.pending ? `, ${r.pending} queued` : ""}` },
                { label: "Delivered", value: r.delivered, note: pct(r.delivered, r.sent) },
                { label: "Read", value: r.read, note: pct(r.read, r.delivered) },
                { label: "Replied", value: r.replied, note: pct(r.replied, r.delivered) },
                { label: "Failed", value: r.failed, note: r.skipped ? `${r.skipped} skipped (opt-outs)` : "" },
                { label: "New leads", value: r.leads, note: "within 7 days" },
                { label: "Orders", value: r.orders, note: "within 30 days" },
                { label: "Revenue", value: formatMoney(r.revenue, ctx.business.currency), note: "from those orders" },
              ].map((k) => (
                <div key={k.label} className="border-line px-5 py-4 [&:nth-child(n+5)]:border-t">
                  <p className="text-[13px] text-muted">{k.label}</p>
                  <p className="mt-1 text-[24px] font-semibold tracking-tight">{k.value}</p>
                  <p className="text-[12px] text-muted">{k.note}</p>
                </div>
              ))}
            </Panel>
            {failures.length > 0 && (
              <Panel>
                <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Not delivered</h2>
                <ul className="divide-y divide-line text-[13.5px]">
                  {failures.map((f) => (
                    <li key={f.id} className="flex flex-wrap gap-x-4 px-5 py-2.5">
                      <Link href={`/customers/${f.customer_id}`} className="w-40 tabular-nums hover:text-signal">{formatPhone(f.phone)}</Link>
                      <span className={f.status === "failed" ? "text-danger" : "text-muted"}>{f.status === "failed" ? "Failed" : "Skipped"}</span>
                      <span className="flex-1 text-muted">{f.last_error}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
          <div className="flex flex-col gap-6">
            {canSend && (
              <Panel className="flex flex-wrap gap-2 p-5">
                {(
                  [
                    ["pause", campaign.status === "sending", "secondary", "Pause"],
                    ["resume", campaign.status === "paused", "primary", "Resume"],
                    ["unschedule", campaign.status === "scheduled", "secondary", "Back to draft"],
                    ["cancel", ["scheduled", "sending", "paused"].includes(campaign.status), "danger", "Cancel"],
                  ] as const
                ).filter(([, show]) => show).map(([action, , variant, label]) => (
                  <ActionForm key={action} action={changeCampaignState}>
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="action" value={action} />
                    <SubmitButton variant={variant}>{label}</SubmitButton>
                  </ActionForm>
                ))}
              </Panel>
            )}
            {can(ctx, "campaigns.manage") && (
              <ActionForm action={duplicateCampaign}>
                <input type="hidden" name="campaignId" value={campaign.id} />
                <SubmitButton variant="secondary">Duplicate as a new draft</SubmitButton>
              </ActionForm>
            )}
            <Panel>
              <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">History</h2>
              <ol className="flex flex-col gap-1.5 p-5 text-[13px]">
                {events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3">
                    <span>
                      {EVENT[e.type] ?? e.type}
                      {e.type === "started" && e.detail ? ` · ${e.detail.recipients} recipients` : ""}
                    </span>
                    <time className="text-muted tabular-nums">{formatDateTime(e.createdAt, tz)}</time>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
