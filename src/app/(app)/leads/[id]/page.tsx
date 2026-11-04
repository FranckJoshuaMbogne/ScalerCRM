import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, MessageCircle, PenLine, Phone } from "lucide-react";
import { FollowUpForm } from "@/components/crm/follow-up-form";
import { TaskList } from "@/components/crm/task-list";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { NoAccess } from "@/components/ui/no-access";
import { linkButton, PageHeader, Panel, StatusBadge } from "@/components/ui/primitives";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { formatCustomValue } from "@/modules/custom-fields/engine";
import { listFieldDefinitions } from "@/modules/custom-fields/queries";
import { setLeadArchived } from "@/modules/leads/actions";
import { listLostReasons, listSources, listStatuses } from "@/modules/leads/config";
import { getLead } from "@/modules/leads/queries";
import { ACTIVITY_LABELS, describeLeadActivity } from "@/modules/leads/timeline";
import { listLeadTasks } from "@/modules/tasks/queries";
import { describeDue, followUpPresets, toLocalInput } from "@/modules/tasks/schedule";
import { listBranches, listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { ActivityForm, EditLeadForm, StatusForm } from "../lead-forms";

export const metadata = { title: "Lead" };

const TOUCH_LABELS: Record<string, string> = {
  utm_source: "UTM source",
  utm_medium: "UTM medium",
  utm_campaign: "UTM campaign",
  utm_term: "UTM term",
  utm_content: "UTM content",
  gclid: "Google click ID",
  fbclid: "Meta click ID",
  campaign_id: "Campaign ID",
  adset_id: "Ad set ID",
  ad_id: "Ad ID",
  form_id: "Form ID",
  page_url: "Page",
  referrer: "Referrer",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Touch({ title, touch, campaign }: { title: string; touch: Record<string, string>; campaign: string | null }) {
  const entries = Object.entries(touch).filter(([, v]) => v);
  if (!entries.length && !campaign) return null;
  return (
    <div>
      <p className="mb-1 text-[12.5px] font-medium text-muted">{title}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
        {campaign && (
          <>
            <dt className="text-muted">Campaign</dt>
            <dd className="break-all">{campaign}</dd>
          </>
        )}
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{TOUCH_LABELS[k] ?? k}</dt>
            <dd className="break-all">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default async function LeadPage({ params, searchParams }: PageProps<"/leads/[id]">) {
  const ctx = await getContext();
  if (!can(ctx, "leads.view_all") && !can(ctx, "leads.view_assigned")) return <NoAccess what="leads" />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;

  const businessId = ctx.business.businessId;
  const [lead, statuses, sources, branches, members, fields, reasons, tasks] = await Promise.all([
    getLead(id),
    listStatuses(businessId),
    listSources(businessId),
    listBranches(businessId),
    listMembers(businessId),
    listFieldDefinitions(businessId, "lead"),
    listLostReasons(businessId),
    listLeadTasks(id),
  ]);
  if (!lead) notFound();
  const tz = ctx.business.timezone;
  const now = new Date();
  const presets = followUpPresets(now, tz).map(({ key, label }) => ({ key, label }));
  const canTasks = can(ctx, "tasks.manage") && !lead.archivedAt;
  const activeMembers = members.filter((m) => m.status === "active");
  const assignees = can(ctx, "tasks.view_all") ? activeMembers.map((m) => ({ value: m.userId, label: m.name })) : undefined;
  const reasonName = new Map(reasons.map((r) => [r.id, r.name]));

  const status = new Map(statuses.map((s) => [s.id, s]));
  const sourceName = new Map(sources.map((s) => [s.id, s.name]));
  const person = new Map(members.map((m) => [m.userId, m.name]));
  const current = status.get(lead.statusId);
  const canEdit = can(ctx, "leads.edit") && !lead.archivedAt;
  const names = {
    status: (v: unknown) => status.get(v as string)?.name,
    source: (v: unknown) => sourceName.get(v as string),
    person: (v: unknown) => person.get(v as string),
    reason: (v: unknown) => reasonName.get(v as string),
  };
  const phone = lead.customer?.phone ?? null;
  const quick =
    "flex flex-1 flex-col items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface py-2 text-[12px] font-medium active:bg-paper";

  return (
    <>
      <Link href="/leads" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Leads
      </Link>
      <PageHeader
        title={`${lead.leadNumber} · ${lead.customer?.fullName ?? "Unknown customer"}`}
        description={lead.title ?? undefined}
        actions={
          <>
            {can(ctx, "orders.create") && !lead.archivedAt && (
              <>
                <Link href={`/orders/new?kind=quotation&customer=${lead.customerId}&lead=${lead.id}`} className={linkButton.secondary}>Quotation</Link>
                <Link href={`/orders/new?customer=${lead.customerId}&lead=${lead.id}`} className={linkButton.secondary}>Order</Link>
              </>
            )}
            {can(ctx, "appointments.manage") && !lead.archivedAt && (
              <Link href={`/appointments/new?customer=${lead.customerId}&lead=${lead.id}`} className={linkButton.secondary}>Book visit</Link>
            )}
            {current && <StatusBadge stage={current.stage} name={current.name} />}
          </>
        }
      />

      {sp.created && (
        <p role="status" className="mb-4 rounded-[var(--radius-control)] bg-signal-soft px-3 py-2 text-[13.5px]">
          Lead saved.{" "}
          {sp.existing
            ? `Added to ${lead.customer?.cifNumber}.`
            : sp.matched
              ? `This ${sp.matched === "email" ? "email" : "phone number"} was already on file, so the lead was added to ${lead.customer?.cifNumber}.`
              : `A new customer file ${lead.customer?.cifNumber} was created.`}
        </p>
      )}
      {sp.walkin && (
        <p role="status" className="mb-4 rounded-[var(--radius-control)] bg-signal-soft px-3 py-2 text-[13.5px]">
          Walk-in registered.{" "}
          {sp.new
            ? `New customer file ${lead.customer?.cifNumber} and a walk-in lead were created.`
            : sp.existing
              ? `${lead.customer?.fullName} is a returning customer, so the visit was added to this open lead.`
              : `${lead.customer?.fullName} was already on file; a new walk-in lead was opened.`}
          {sp.arrived && " Their booking for today is marked as arrived."}
        </p>
      )}
      {lead.archivedAt && (
        <p className="mb-4 rounded-[var(--radius-control)] bg-line/60 px-3 py-2 text-[13.5px]">
          Archived on {formatDateTime(lead.archivedAt, ctx.business.timezone)}. Restore it to make changes.
        </p>
      )}

      {/* Phone quick actions: call, WhatsApp, log, follow-up */}
      <nav aria-label="Quick actions" className="mb-4 flex gap-2 lg:hidden">
        {phone && (
          <>
            <a href={`tel:${phone}`} className={quick}>
              <Phone className="size-[18px]" /> Call
            </a>
            <a href={`https://wa.me/${phone.slice(1)}`} target="_blank" rel="noreferrer" className={quick}>
              <MessageCircle className="size-[18px]" /> WhatsApp
            </a>
          </>
        )}
        {canEdit && (
          <a href="#log" className={quick}>
            <PenLine className="size-[18px]" /> Log
          </a>
        )}
        {canTasks && (
          <a href="#follow-up" className={quick}>
            <CalendarPlus className="size-[18px]" /> Follow-up
          </a>
        )}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel id="follow-up" className="scroll-mt-20">
            <h2 className="flex items-center justify-between border-b border-line px-5 py-3.5 text-[15px] font-semibold">
              Follow-ups
              <span className="text-[13px] font-normal text-muted">{tasks.open.length} open</span>
            </h2>
            {tasks.open.length > 0 && (
              <TaskList
                tasks={tasks.open}
                now={now}
                timeZone={tz}
                presets={presets}
                people={person}
                assignees={assignees}
                showAssignee
                showLead={false}
                canManage={can(ctx, "tasks.manage")}
              />
            )}
            {canTasks ? (
              <div className="border-t border-line p-5">
                <FollowUpForm
                  leadId={lead.id}
                  presets={presets}
                  assignees={assignees}
                  defaultAssignee={lead.ownerId ?? ctx.user.id}
                  minDate={toLocalInput(now, tz)}
                />
              </div>
            ) : (
              tasks.open.length === 0 && <p className="px-5 py-4 text-[13.5px] text-muted">No follow-ups planned.</p>
            )}
          </Panel>

          {canEdit && (
            <Panel id="log" className="scroll-mt-20 p-5">
              <h2 className="mb-4 text-[15px] font-semibold">Log activity</h2>
              <ActivityForm leadId={lead.id} />
            </Panel>
          )}

          <Panel>
            <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">Timeline</h2>
            <ol className="divide-y divide-line">
              {lead.activities.map((a) => {
                const manual = a.type in ACTIVITY_LABELS;
                return (
                  <li key={a.id} className="px-5 py-3 text-[13.5px]">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <p>
                        {manual && (
                          <span className="mr-1.5 rounded bg-paper px-1.5 py-0.5 text-[11.5px] font-medium text-muted">
                            {ACTIVITY_LABELS[a.type]}
                          </span>
                        )}
                        <span className="font-medium">
                          {a.actorId ? (person.get(a.actorId) ?? "Former member") : "System"}
                        </span>{" "}
                        {manual ? "" : describeLeadActivity(a, names)}
                      </p>
                      <time className="text-[12px] text-muted tabular-nums">
                        {formatDateTime(a.occurredAt, ctx.business.timezone)}
                      </time>
                    </div>
                    {a.body && <p className="mt-1 whitespace-pre-line text-muted">{a.body}</p>}
                  </li>
                );
              })}
            </ol>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel className="p-5">
            {canEdit ? (
              <StatusForm
                key={`${lead.statusId}:${lead.lostReasonId ?? ""}`}
                leadId={lead.id}
                statusId={lead.statusId}
                lostReasonId={lead.lostReasonId}
                statuses={statuses
                  .filter((s) => s.isActive || s.id === lead.statusId)
                  .map((s) => ({ value: s.id, label: s.name, category: s.category }))}
                lostReasons={reasons
                  .filter((r) => r.isActive || r.id === lead.lostReasonId)
                  .map((r) => ({ value: r.id, label: r.name }))}
              />
            ) : (
              <p className="text-[13.5px]">Stage: {current?.name}</p>
            )}
            {lead.lostReasonId && (
              <p className="mt-3 text-[13px] text-muted">
                Lost: <span className="text-text">{reasonName.get(lead.lostReasonId)}</span>
                {lead.lostNote && <span className="block whitespace-pre-line">{lead.lostNote}</span>}
              </p>
            )}
          </Panel>

          {lead.customer && (
            <Panel className="p-5">
              <p className="text-[12.5px] font-medium text-muted">Customer</p>
              <Link href={`/customers/${lead.customer.id}`} className="mt-1 block text-[15px] font-semibold hover:text-signal">
                {lead.customer.fullName}
              </Link>
              <p className="text-[13px] text-muted">{lead.customer.cifNumber}</p>
              {lead.customer.phone && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href={`tel:${lead.customer.phone}`} className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-[13px] hover:bg-paper">
                    Call {formatPhone(lead.customer.phone)}
                  </a>
                  <a
                    href={`https://wa.me/${lead.customer.phone.slice(1)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-[13px] hover:bg-paper"
                  >
                    WhatsApp
                  </a>
                </div>
              )}
            </Panel>
          )}

          <Panel className="flex flex-col gap-4 p-5 text-[13.5px]">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted">Value</dt>
              <dd className="tabular-nums">{formatMoney(lead.expectedValue, ctx.business.currency)}</dd>
              <dt className="text-muted">Owner</dt>
              <dd>
                {lead.ownerId ? (
                  (person.get(lead.ownerId) ?? "Former member")
                ) : (
                  <span className="rounded-full bg-stage-negotiation/15 px-2 py-0.5 text-[12px] font-medium">Unassigned</span>
                )}
              </dd>
              <dt className="text-muted">Next follow-up</dt>
              <dd className={lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) < now ? "font-medium text-danger" : undefined}>
                {lead.nextFollowUpAt ? describeDue(new Date(lead.nextFollowUpAt), now, tz) : "None planned"}
              </dd>
              <dt className="text-muted">First source</dt>
              <dd>{(lead.sourceId && sourceName.get(lead.sourceId)) ?? "—"}</dd>
              <dt className="text-muted">Latest source</dt>
              <dd>{(lead.latestSourceId && sourceName.get(lead.latestSourceId)) ?? "—"}</dd>
              <dt className="text-muted">Created</dt>
              <dd>{formatDateTime(lead.createdAt, ctx.business.timezone)}</dd>
              {fields.map((f) => (
                <div key={f.key} className="contents">
                  <dt className="text-muted">{f.label}</dt>
                  <dd>{formatCustomValue(f, lead.customFields[f.key])}</dd>
                </div>
              ))}
            </dl>
            <Touch title="First touch" touch={lead.firstTouch} campaign={lead.firstCampaign} />
            <Touch title="Latest touch" touch={lead.latestTouch} campaign={lead.latestCampaign} />
            {lead.description && <p className="whitespace-pre-line text-muted">{lead.description}</p>}
          </Panel>

          {canEdit && (
            <Panel className="p-5">
              <details>
                <summary className="cursor-pointer text-[14px] font-semibold select-none">Edit details</summary>
                <div className="mt-4">
                  <EditLeadForm
                    lead={lead}
                    branches={branches.filter((b) => b.isActive || b.id === lead.branchId).map((b) => ({ value: b.id, label: b.name }))}
                    owners={members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name }))}
                    fields={fields}
                    currency={ctx.business.currency}
                    canAssign={can(ctx, "leads.assign")}
                  />
                </div>
              </details>
            </Panel>
          )}

          {can(ctx, "leads.delete") && (
            <ActionForm action={setLeadArchived}>
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="archive" value={String(!lead.archivedAt)} />
              <SubmitButton variant={lead.archivedAt ? "secondary" : "danger"}>
                {lead.archivedAt ? "Restore lead" : "Archive lead"}
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    </>
  );
}
