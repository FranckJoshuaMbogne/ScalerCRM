import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ConversationListItem = {
  id: string;
  accountId: string;
  assigneeId: string | null;
  status: "open" | "closed";
  labels: string[];
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastInboundAt: string | null;
  awaitingSince: string | null;
  unreadCount: number;
  customer: { id: string; fullName: string; phone: string | null } | null;
};

export type InboxFilter = { view: "mine" | "unassigned" | "all" | "waiting" | "closed"; label?: string; q?: string };

const COLUMNS =
  "id, account_id, assignee_id, status, labels, last_message_at, last_message_preview, last_inbound_at, awaiting_since, unread_count, customer_id";

type Row = {
  id: string;
  account_id: string;
  assignee_id: string | null;
  status: "open" | "closed";
  labels: string[];
  last_message_at: string | null;
  last_message_preview: string | null;
  last_inbound_at: string | null;
  awaiting_since: string | null;
  unread_count: number;
  customer_id: string;
};

export async function listConversations(businessId: string, userId: string, filter: InboxFilter, customerIds?: string[] | null) {
  const supabase = await createClient();
  let query = supabase
    .from("conversations")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (filter.view === "closed") query = query.eq("status", "closed");
  else query = query.eq("status", "open");
  if (filter.view === "mine") query = query.eq("assignee_id", userId);
  if (filter.view === "unassigned") query = query.is("assignee_id", null);
  if (filter.view === "waiting") query = query.not("awaiting_since", "is", null);
  if (filter.label) query = query.contains("labels", [filter.label]);
  if (customerIds) query = query.in("customer_id", customerIds.length ? customerIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await query.returns<Row[]>();
  if (error) throw new Error(`Could not load conversations: ${error.message}`);
  const rows = data ?? [];
  const { data: customers } = rows.length
    ? await supabase.from("customers").select("id, full_name, primary_phone").in("id", [...new Set(rows.map((r) => r.customer_id))])
    : { data: [] };
  const cust = new Map((customers ?? []).map((c) => [c.id, { id: c.id, fullName: c.full_name, phone: c.primary_phone }]));
  return rows.map(
    (r): ConversationListItem => ({
      id: r.id,
      accountId: r.account_id,
      assigneeId: r.assignee_id,
      status: r.status,
      labels: r.labels ?? [],
      lastMessageAt: r.last_message_at,
      lastMessagePreview: r.last_message_preview,
      lastInboundAt: r.last_inbound_at,
      awaitingSince: r.awaiting_since,
      unreadCount: r.unread_count,
      customer: cust.get(r.customer_id) ?? null,
    }),
  );
}

export type Message = {
  id: string;
  direction: "inbound" | "outbound" | "note";
  type: string;
  body: string | null;
  media: { id: string; mime_type?: string; filename?: string } | null;
  status: string;
  error: { message?: string; title?: string }[] | { message?: string } | null;
  sentBy: string | null;
  responseSeconds: number | null;
  sentAt: string;
};

export async function getConversation(id: string) {
  const supabase = await createClient();
  const { data: c, error } = await supabase
    .from("conversations")
    .select(`${COLUMNS}, lead_id`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load conversation: ${error.message}`);
  if (!c) return null;
  const [{ data: messages }, { data: account }] = await Promise.all([
    supabase
      .from("messages")
      .select("id, direction, type, body, media, status, error, sent_by, response_seconds, sent_at")
      .eq("conversation_id", id)
      .order("sent_at", { ascending: false })
      .limit(200),
    supabase.from("whatsapp_accounts").select("display_phone, verified_name, status").eq("id", c.account_id).maybeSingle(),
  ]);
  return {
    id: c.id as string,
    customerId: c.customer_id as string,
    leadId: c.lead_id as string | null,
    assigneeId: c.assignee_id as string | null,
    status: c.status as "open" | "closed",
    labels: (c.labels as string[]) ?? [],
    lastInboundAt: c.last_inbound_at as string | null,
    awaitingSince: c.awaiting_since as string | null,
    unreadCount: c.unread_count as number,
    account: account
      ? { displayPhone: account.display_phone as string | null, name: account.verified_name as string | null, status: account.status as string }
      : null,
    messages: (messages ?? [])
      .map(
        (m): Message => ({
          id: m.id,
          direction: m.direction,
          type: m.type,
          body: m.body,
          media: m.media,
          status: m.status,
          error: m.error,
          sentBy: m.sent_by,
          responseSeconds: m.response_seconds,
          sentAt: m.sent_at,
        }),
      )
      .reverse(),
  };
}

/** Labels already used, for suggestions. */
export async function listLabels(businessId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("conversations").select("labels").eq("business_id", businessId).limit(1000);
  return [...new Set((data ?? []).flatMap((r) => (r.labels as string[]) ?? []))].sort();
}

/** Median first-response time over the last 7 days, in seconds (visible messages only). */
export async function responseStats(businessId: string) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data } = await supabase
    .from("messages")
    .select("response_seconds")
    .eq("business_id", businessId)
    .eq("direction", "outbound")
    .not("response_seconds", "is", null)
    .gte("sent_at", since)
    .limit(2000);
  const values = (data ?? []).map((r) => r.response_seconds as number).sort((a, b) => a - b);
  if (!values.length) return null;
  return { median: values[Math.floor(values.length / 2)], count: values.length };
}

export async function conversationForCustomer(customerId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversations")
    .select("id, last_message_at")
    .eq("customer_id", customerId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return data?.id as string | undefined;
}
