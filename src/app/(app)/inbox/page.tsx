import Link from "next/link";
import type { CountryCode } from "libphonenumber-js";
import { ArrowLeft, Check, CheckCheck, Clock, Plug } from "lucide-react";
import { QuickContact } from "@/components/crm/quick-contact";
import { NoAccess } from "@/components/ui/no-access";
import { EmptyState, linkButton, PageHeader, Panel, StatusBadge } from "@/components/ui/primitives";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getCustomer } from "@/modules/customers/queries";
import { type InboxFilter, getConversation, listConversations, listLabels, responseStats } from "@/modules/inbox/queries";
import { windowState } from "@/modules/integrations/whatsapp/webhook";
import { listStatuses } from "@/modules/leads/config";
import { getLead, matchingCustomerIds } from "@/modules/leads/queries";
import { getCustomerValue, listOrderStages } from "@/modules/orders/queries";
import { createClient } from "@/lib/supabase/server";
import { listMembers } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { Composer, ConversationControls, InboxLive } from "./inbox-client";

export const metadata = { title: "WhatsApp inbox" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ago(iso: string | null, now: Date) {
  if (!iso) return "";
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

function duration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const ctx = await getContext();
  const canAll = can(ctx, "inbox.view_all");
  if (!canAll && !can(ctx, "inbox.view_assigned")) return <NoAccess what="the WhatsApp inbox" />;
  const sp = await searchParams;
  const views = (canAll ? ["mine", "unassigned", "waiting", "all", "closed"] : ["mine", "waiting", "closed"]) as InboxFilter["view"][];
  const view = (views.includes(one(sp.view) as InboxFilter["view"]) ? one(sp.view) : canAll ? "all" : "mine") as InboxFilter["view"];
  const openId = UUID.test(one(sp.c)) ? one(sp.c) : null;
  const q = one(sp.q);
  const label = one(sp.label) || undefined;
  const businessId = ctx.business.businessId;
  const now = new Date();
  const tz = ctx.business.timezone;

  const supabase = await createClient();
  const { count: accounts } = await supabase
    .from("whatsapp_accounts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .neq("status", "disconnected");

  const match = q ? await matchingCustomerIds(businessId, q, ctx.business.countryCode as CountryCode) : null;
  const [list, conversation, members, labels, stats] = await Promise.all([
    listConversations(businessId, ctx.user.id, { view, label }, q ? (match?.ids ?? []) : null),
    openId ? getConversation(openId) : Promise.resolve(null),
    listMembers(businessId),
    listLabels(businessId),
    responseStats(businessId),
  ]);
  const people = new Map(members.map((m) => [m.userId, m.name]));
  const inboxPeople = members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.name }));

  const [customer, lead, statuses, orderStages] = conversation
    ? await Promise.all([
        getCustomer(conversation.customerId),
        conversation.leadId ? getLead(conversation.leadId) : Promise.resolve(null),
        listStatuses(businessId),
        listOrderStages(businessId),
      ])
    : [null, null, [], []];
  const value =
    conversation && (can(ctx, "orders.view_all") || can(ctx, "orders.view_assigned"))
      ? await getCustomerValue(conversation.customerId, orderStages.filter((s) => s.category === "cancelled").map((s) => s.id))
      : null;
  const leadStatus = lead ? statuses.find((s) => s.id === lead.statusId) : undefined;
  const win = conversation ? windowState(conversation.lastInboundAt, now) : null;
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view, q: q || undefined, label, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/inbox?${p}`;
  };

  if (!accounts) {
    return (
      <>
        <PageHeader title="WhatsApp inbox" />
        <Panel className="flex flex-col items-start gap-3 p-8">
          <Plug className="size-5 text-muted" />
          <p className="text-[15px] font-medium">No WhatsApp number is connected yet</p>
          <p className="max-w-[60ch] text-[14px] text-muted">
            Connect the business&apos;s WhatsApp number and incoming messages will appear here, matched to customer files and leads.
          </p>
          {can(ctx, "integrations.manage") && <Link href="/integrations" className={linkButton.primary}>Connect WhatsApp</Link>}
        </Panel>
      </>
    );
  }

  return (
    <>
      <InboxLive businessId={businessId} openId={conversation?.id ?? null} unread={conversation?.unreadCount ?? 0} />
      <datalist id="label-suggestions">{labels.map((l) => <option key={l} value={l} />)}</datalist>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[22px] font-semibold tracking-tight">WhatsApp inbox</h1>
        {stats && (
          <p className="text-[13px] text-muted">
            Median first reply this week: <span className="font-medium text-text">{duration(stats.median)}</span> ({stats.count} replies)
          </p>
        )}
      </div>

      <div className="grid h-[calc(100dvh-11rem)] min-h-[480px] gap-4 lg:grid-cols-[340px_1fr] xl:grid-cols-[340px_1fr_300px]">
        {/* Conversation list */}
        <Panel className={cn("flex min-h-0 flex-col", openId && "hidden lg:flex")}>
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <nav aria-label="Inbox views" className="flex gap-1 overflow-x-auto">
              {views.map((v) => (
                <Link key={v} href={qs({ view: v, c: undefined })} aria-current={view === v ? "page" : undefined}
                  className="rounded-full px-2.5 py-1 text-[12.5px] whitespace-nowrap text-muted capitalize hover:bg-paper aria-[current=page]:bg-paper aria-[current=page]:font-medium aria-[current=page]:text-text">
                  {v}
                </Link>
              ))}
            </nav>
            <form role="search" className="flex gap-1.5">
              <input type="hidden" name="view" value={view} />
              <input type="search" name="q" defaultValue={q} placeholder="Name or phone" aria-label="Search conversations"
                className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[13px]" />
              {labels.length > 0 && (
                <select name="label" defaultValue={label ?? ""} aria-label="Label" className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-1.5 text-[13px]">
                  <option value="">Any label</option>
                  {labels.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              )}
            </form>
          </div>
          {list.length === 0 ? (
            <EmptyState title="No conversations here" />
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              {list.map((c) => {
                const w = windowState(c.lastInboundAt, now);
                return (
                  <li key={c.id}>
                    <Link href={qs({ c: c.id })} aria-current={c.id === openId ? "true" : undefined}
                      className="block px-3 py-2.5 hover:bg-paper/60 aria-[current=true]:bg-signal-soft/50">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-[14px]", c.unreadCount > 0 && "font-semibold")}>{c.customer?.fullName ?? "Unknown"}</span>
                        <span className="shrink-0 text-[11.5px] text-muted tabular-nums">{ago(c.lastMessageAt, now)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{c.lastMessagePreview ?? ""}</p>
                        {c.unreadCount > 0 && (
                          <span className="rounded-full bg-signal px-1.5 text-[11px] font-semibold text-white tabular-nums">{c.unreadCount}</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                        {c.awaitingSince && <span className="font-medium text-stage-negotiation">Waiting {ago(c.awaitingSince, now)}</span>}
                        {!w.open && <span>Window closed</span>}
                        <span>{c.assigneeId ? (people.get(c.assigneeId) ?? "Former member") : "Unassigned"}</span>
                        {c.labels.map((l) => <span key={l} className="rounded bg-paper px-1">{l}</span>)}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Thread */}
        <Panel className={cn("flex min-h-0 flex-col", !openId && "hidden lg:flex")}>
          {!conversation ? (
            <div className="grid flex-1 place-items-center p-8 text-[14px] text-muted">Pick a conversation.</div>
          ) : (
            <>
              <div className="flex flex-col gap-2 border-b border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={qs({ c: undefined })} className="lg:hidden" aria-label="Back to conversations"><ArrowLeft className="size-5" /></Link>
                  <Link href={`/customers/${conversation.customerId}`} className="text-[15px] font-semibold hover:text-signal">
                    {customer?.fullName ?? "Customer"}
                  </Link>
                  <span className="text-[12.5px] text-muted tabular-nums">
                    {formatPhone(customer?.contacts.find((x) => x.kind === "phone")?.value)}
                  </span>
                  <span className={cn("ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium",
                    win?.open ? "bg-stage-won/15" : "bg-line")}>
                    <Clock className="size-3" />
                    {win?.open && win.closesAt
                      ? `Window open · closes ${formatDateTime(win.closesAt.toISOString(), tz)}`
                      : "Window closed"}
                  </span>
                </div>
                <ConversationControls
                  key={conversation.id}
                  conversationId={conversation.id}
                  assigneeId={conversation.assigneeId}
                  status={conversation.status}
                  labels={conversation.labels}
                  people={inboxPeople}
                  canAssignOthers={canAll}
                  me={ctx.user.id}
                />
              </div>
              <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-paper/40 p-3">
                {conversation.messages.map((m) => (
                  <li key={m.id} className={cn("flex", m.direction === "outbound" ? "justify-end" : m.direction === "note" ? "justify-center" : "justify-start")}>
                    <div className={cn("max-w-[85%] rounded-[var(--radius-panel)] px-3 py-2 text-[14px] shadow-sm",
                      m.direction === "inbound" && "bg-surface",
                      m.direction === "outbound" && "bg-signal-soft",
                      m.direction === "note" && "border border-dashed border-stage-negotiation/50 bg-stage-negotiation/10 text-[13px]")}>
                      {m.direction === "note" && <p className="mb-0.5 text-[11.5px] font-medium text-muted">Note · {m.sentBy ? people.get(m.sentBy) : ""}</p>}
                      {m.media && (
                        m.media.mime_type?.startsWith("image/") ? (
                          <a href={`/api/whatsapp/media/${m.id}`} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element -- streamed through our own auth-checked route */}
                            <img src={`/api/whatsapp/media/${m.id}`} alt={m.body ?? "Image from customer"} className="mb-1 max-h-64 rounded" loading="lazy" />
                          </a>
                        ) : (
                          <a href={`/api/whatsapp/media/${m.id}`} target="_blank" rel="noreferrer" className="mb-1 block text-signal underline">
                            {m.media.filename ?? `Open ${m.type}`}
                          </a>
                        )
                      )}
                      {m.body ? <p className="whitespace-pre-line break-words">{m.body}</p> : !m.media && <p className="text-muted italic">[{m.type}]</p>}
                      <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted tabular-nums">
                        {m.direction === "outbound" && m.sentBy && <span>{people.get(m.sentBy)} ·</span>}
                        {formatDateTime(m.sentAt, tz)}
                        {m.direction === "outbound" && (
                          m.status === "read" ? <CheckCheck className="size-3.5 text-signal" aria-label="Read" />
                          : m.status === "delivered" ? <CheckCheck className="size-3.5" aria-label="Delivered" />
                          : m.status === "sent" ? <Check className="size-3.5" aria-label="Sent" />
                          : m.status === "failed" ? <span className="font-medium text-danger">Failed</span>
                          : <Clock className="size-3" aria-label="Sending" />
                        )}
                      </p>
                    </div>
                  </li>
                ))}
                <li id="thread-end" aria-hidden />
              </ol>
              <Composer conversationId={conversation.id} canReply={can(ctx, "inbox.reply")} windowOpen={Boolean(win?.open)} />
            </>
          )}
        </Panel>

        {/* Customer panel */}
        {conversation && customer && (
          <Panel className="hidden min-h-0 flex-col gap-4 overflow-y-auto p-4 text-[13.5px] xl:flex">
            <div>
              <p className="text-[12px] font-medium text-muted">Customer</p>
              <Link href={`/customers/${customer.id}`} className="text-[15px] font-semibold hover:text-signal">{customer.fullName}</Link>
              <p className="text-muted">{customer.cifNumber}</p>
              <QuickContact phone={customer.contacts.find((x) => x.kind === "phone")?.value ?? null} className="mt-2" compact />
            </div>
            {lead && (
              <div className="border-t border-line pt-3">
                <p className="text-[12px] font-medium text-muted">Lead</p>
                <Link href={`/leads/${lead.id}`} className="font-medium hover:text-signal">{lead.leadNumber}</Link>
                {leadStatus && <div className="mt-1"><StatusBadge stage={leadStatus.stage} name={leadStatus.name} /></div>}
                <p className="mt-1 text-muted">Owner: {lead.ownerId ? (people.get(lead.ownerId) ?? "Former member") : "Unassigned"}</p>
              </div>
            )}
            {value && (
              <div className="border-t border-line pt-3">
                <p className="text-[12px] font-medium text-muted">Purchases</p>
                <p>{value.ordersCount} order{value.ordersCount === 1 ? "" : "s"} · {formatMoney(value.lifetimeValue, ctx.business.currency)}</p>
                {Number(value.outstanding) > 0 && <p className="text-muted">Owes {formatMoney(value.outstanding, ctx.business.currency)}</p>}
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {can(ctx, "appointments.manage") && (
                <Link href={`/appointments/new?customer=${customer.id}${lead ? `&lead=${lead.id}` : ""}`} className={linkButton.secondary}>Book visit</Link>
              )}
              {can(ctx, "orders.create") && (
                <Link href={`/orders/new?kind=quotation&customer=${customer.id}${lead ? `&lead=${lead.id}` : ""}`} className={linkButton.secondary}>Quote</Link>
              )}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
