import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteTemplate, syncTemplates } from "@/modules/campaigns/actions";
import { listAccounts, listTemplates } from "@/modules/campaigns/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { TemplateForm } from "../campaign-forms";

export const metadata = { title: "WhatsApp templates" };

const STATUS = { draft: "Draft", pending: "In review", approved: "Approved", rejected: "Rejected", paused: "Paused", disabled: "Disabled" } as const;

export default async function TemplatesPage({ searchParams }: PageProps<"/campaigns/templates">) {
  const ctx = await getContext();
  const manage = can(ctx, "templates.manage");
  if (!manage && !can(ctx, "campaigns.manage")) return <NoAccess what="templates" />;
  const sp = await searchParams;
  const [templates, accounts] = await Promise.all([listTemplates(ctx.business.businessId), listAccounts(ctx.business.businessId)]);
  const tz = ctx.business.timezone;
  const byWaba = [...new Map(accounts.map((a) => [a.wabaId, a])).values()];

  return (
    <>
      <Link href="/campaigns" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">Campaigns</Link>
      <PageHeader
        title="WhatsApp templates"
        description="Messages WhatsApp has approved for sending outside the 24-hour window. Review usually takes minutes, sometimes a day."
      />
      {sp.submitted && (
        <p role="status" className="mb-4 rounded-[var(--radius-control)] bg-signal-soft px-3 py-2 text-[13.5px]">
          Submitted. The status updates by itself when WhatsApp decides, or press Sync.
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_440px]">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="text-[15px] font-semibold">Templates</h2>
            {manage && byWaba.map((a) => (
              <ActionForm key={a.id} action={syncTemplates}>
                <input type="hidden" name="accountId" value={a.id} />
                <SubmitButton variant="ghost">Sync {byWaba.length > 1 ? a.label : "from WhatsApp"}</SubmitButton>
              </ActionForm>
            ))}
          </div>
          {templates.length === 0 ? (
            <EmptyState title="No templates yet" />
          ) : (
            <ul className="divide-y divide-line">
              {templates.map((t) => (
                <li key={t.id} className="flex flex-col gap-1 px-5 py-3 text-[13.5px]">
                  <div className="flex flex-wrap items-center gap-x-3">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-muted">{t.language} · {t.category.toLowerCase()}</span>
                    <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[12px] font-medium",
                      t.status === "approved" ? "bg-stage-won/15" : t.status === "rejected" ? "bg-danger/10 text-danger" : "bg-line")}>
                      {STATUS[t.status]}
                    </span>
                  </div>
                  <p className="whitespace-pre-line text-muted">{t.components.body?.text}</p>
                  {t.rejectedReason && <p className="text-[12.5px] text-danger">Reason: {t.rejectedReason.replace(/_/g, " ").toLowerCase()}</p>}
                  <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
                    {t.syncedAt && <span>Checked {formatDateTime(t.syncedAt, tz)}</span>}
                    {manage && (t.status === "draft" || t.status === "rejected") && (
                      <ActionForm action={deleteTemplate}>
                        <input type="hidden" name="templateId" value={t.id} />
                        <SubmitButton variant="ghost">Remove</SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {manage && (
          <Panel className="h-fit p-5">
            <h2 className="mb-4 text-[15px] font-semibold">New template</h2>
            {accounts.length ? (
              <TemplateForm accounts={accounts.map((a) => ({ value: a.id, label: a.label }))} />
            ) : (
              <p className="text-[13.5px] text-muted">Connect a WhatsApp number under <Link href="/integrations" className="text-signal underline">Integrations</Link> first.</p>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
