import Link from "next/link";
import { Plus } from "lucide-react";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { listCampaigns, listTemplates } from "@/modules/campaigns/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { CampaignStatus } from "./status";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const ctx = await getContext();
  if (!can(ctx, "campaigns.view") && !can(ctx, "campaigns.manage")) return <NoAccess what="campaigns" />;
  const [campaigns, templates] = await Promise.all([listCampaigns(ctx.business.businessId), listTemplates(ctx.business.businessId)]);
  const templateName = new Map(templates.map((t) => [t.id, t.name]));
  const approved = templates.filter((t) => t.status === "approved").length;
  const tz = ctx.business.timezone;

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Approved WhatsApp templates sent to customers who opted in, throttled and tracked through to orders."
        actions={
          <>
            {(can(ctx, "templates.manage") || can(ctx, "campaigns.manage")) && (
              <Link href="/campaigns/templates" className={linkButton.secondary}>Templates ({approved} approved)</Link>
            )}
            {can(ctx, "campaigns.manage") && <Link href="/campaigns/suppressions" className={linkButton.secondary}>Suppression list</Link>}
            {can(ctx, "campaigns.manage") && (
              <Link href="/campaigns/new" className={linkButton.primary}><Plus className="size-4" /> New campaign</Link>
            )}
          </>
        }
      />
      <Panel>
        {campaigns.length === 0 ? (
          <EmptyState title="No campaigns yet">
            {approved === 0 ? "Start with a template: WhatsApp has to approve it before it can be sent." : "Create one from an approved template."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {campaigns.map((c) => (
              <li key={c.id}>
                <Link href={`/campaigns/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13.5px] hover:bg-paper/60">
                  <span className="min-w-40 flex-1 font-medium">{c.name}</span>
                  <span className="text-muted">{c.templateId ? templateName.get(c.templateId) : "—"}</span>
                  <span className="text-[12.5px] text-muted tabular-nums">
                    {c.startedAt ? `Started ${formatDateTime(c.startedAt, tz)}` : c.scheduledAt ? `Scheduled ${formatDateTime(c.scheduledAt, tz)}` : `Created ${formatDateTime(c.createdAt, tz)}`}
                  </span>
                  <CampaignStatus status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
