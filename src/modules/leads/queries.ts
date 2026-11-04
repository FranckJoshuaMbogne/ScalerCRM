import "server-only";
import type { CountryCode } from "libphonenumber-js";
import { createClient } from "@/lib/supabase/server";
import { parseSearch } from "@/modules/crm/search";
import type { CustomValues } from "@/modules/custom-fields/engine";

export const LEADS_PAGE_SIZE = 25;

export type LeadFilters = {
  q?: string;
  status?: string;
  source?: string;
  branch?: string;
  owner?: string; // "me" | "unassigned" | user id
  view?: "open" | "closed" | "archived" | "all";
  page?: number;
};

export type LeadListItem = {
  id: string;
  leadNumber: string;
  title: string | null;
  expectedValue: string | null;
  statusId: string;
  sourceId: string | null;
  branchId: string | null;
  ownerId: string | null;
  createdAt: string;
  lastActivityAt: string;
  archivedAt: string | null;
  nextFollowUpAt: string | null;
  customer: { id: string; cifNumber: string; fullName: string; phone: string | null } | null;
};

type LeadRow = {
  id: string;
  lead_number: string;
  title: string | null;
  expected_value: string | null;
  status_id: string;
  first_source_id: string | null;
  branch_id: string | null;
  owner_id: string | null;
  created_at: string;
  last_activity_at: string;
  archived_at: string | null;
  next_follow_up_at: string | null;
  customer_id: string;
};

const LIST_COLUMNS =
  "id, lead_number, title, expected_value, status_id, first_source_id, branch_id, owner_id, created_at, last_activity_at, archived_at, next_follow_up_at, customer_id";

function toListItem(l: LeadRow, customers: Map<string, LeadListItem["customer"]>): LeadListItem {
  return {
    id: l.id,
    leadNumber: l.lead_number,
    title: l.title,
    expectedValue: l.expected_value,
    statusId: l.status_id,
    sourceId: l.first_source_id,
    branchId: l.branch_id,
    ownerId: l.owner_id,
    createdAt: l.created_at,
    lastActivityAt: l.last_activity_at,
    archivedAt: l.archived_at,
    nextFollowUpAt: l.next_follow_up_at,
    customer: customers.get(l.customer_id) ?? null,
  };
}

async function customersById(ids: string[]) {
  const map = new Map<string, LeadListItem["customer"]>();
  if (!ids.length) return map;
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, cif_number, full_name, primary_phone")
    .in("id", [...new Set(ids)]);
  for (const c of data ?? []) {
    map.set(c.id, { id: c.id, cifNumber: c.cif_number, fullName: c.full_name, phone: c.primary_phone });
  }
  return map;
}

/** Customer ids matching a search term (name, CIF number, phone, email). */
export async function matchingCustomerIds(businessId: string, q: string, country: CountryCode, limit = 200) {
  const term = parseSearch(q, country);
  if (!term) return null;
  const supabase = await createClient();
  const ors = [`full_name.ilike.%${term.text}%`, `cif_number.ilike.%${term.text}%`, `primary_email.ilike.%${term.text}%`];
  if (term.digits) ors.push(`primary_phone.like.%${term.digits}%`);
  const { data } = await supabase
    .from("customers")
    .select("id")
    .eq("business_id", businessId)
    .or(ors.join(","))
    .limit(limit);
  const ids = new Set((data ?? []).map((c) => c.id as string));

  // Secondary numbers live only in the contacts table.
  if (term.phone || term.digits) {
    const { data: contacts } = await supabase
      .from("customer_contacts")
      .select("customer_id")
      .eq("business_id", businessId)
      .eq("kind", "phone")
      .like("value", term.phone ?? `%${term.digits}%`)
      .limit(limit);
    for (const c of contacts ?? []) ids.add(c.customer_id);
  }
  return { term, ids: [...ids] };
}

export async function listLeads(
  businessId: string,
  userId: string,
  country: CountryCode,
  filters: LeadFilters,
  closedStatusIds: string[],
): Promise<{ items: LeadListItem[]; total: number }> {
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  let query = supabase
    .from("leads")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("business_id", businessId)
    .order("last_activity_at", { ascending: false })
    .range((page - 1) * LEADS_PAGE_SIZE, page * LEADS_PAGE_SIZE - 1);

  const view = filters.view ?? "open";
  if (view === "archived") query = query.not("archived_at", "is", null);
  else if (view !== "all") query = query.is("archived_at", null);
  if (view === "open" && closedStatusIds.length) query = query.not("status_id", "in", `(${closedStatusIds.join(",")})`);
  if (view === "closed") query = query.in("status_id", closedStatusIds.length ? closedStatusIds : ["00000000-0000-0000-0000-000000000000"]);

  if (filters.status) query = query.eq("status_id", filters.status);
  if (filters.source) query = query.eq("first_source_id", filters.source);
  if (filters.branch) query = query.eq("branch_id", filters.branch);
  if (filters.owner === "me") query = query.eq("owner_id", userId);
  else if (filters.owner === "unassigned") query = query.is("owner_id", null);
  else if (filters.owner) query = query.eq("owner_id", filters.owner);

  if (filters.q) {
    const match = await matchingCustomerIds(businessId, filters.q, country);
    if (match) {
      const ors = [`lead_number.ilike.%${match.term.text}%`, `title.ilike.%${match.term.text}%`];
      if (match.ids.length) ors.push(`customer_id.in.(${match.ids.join(",")})`);
      query = query.or(ors.join(","));
    }
  }

  const { data, error, count } = await query.returns<LeadRow[]>();
  if (error) throw new Error(`Could not load leads: ${error.message}`);
  const customers = await customersById((data ?? []).map((l) => l.customer_id));
  return { total: count ?? 0, items: (data ?? []).map((l) => toListItem(l, customers)) };
}

export type BoardFilters = { owner?: string; branch?: string; source?: string };

export const BOARD_LIMIT = 600;
export const BOARD_CLOSED_DAYS = 30;

/**
 * Leads for the kanban board: every open lead, plus leads won or lost in the
 * last 30 days. Archived leads are left out.
 */
export async function listBoardLeads(
  businessId: string,
  userId: string,
  filters: BoardFilters,
  openStatusIds: string[],
): Promise<{ items: LeadListItem[]; truncated: boolean }> {
  const supabase = await createClient();
  const since = new Date(Date.now() - BOARD_CLOSED_DAYS * 86400_000).toISOString();
  let query = supabase
    .from("leads")
    .select(LIST_COLUMNS)
    .eq("business_id", businessId)
    .is("archived_at", null)
    .or(`status_id.in.(${openStatusIds.join(",") || "00000000-0000-0000-0000-000000000000"}),closed_at.gte.${since}`)
    .order("last_activity_at", { ascending: false })
    .limit(BOARD_LIMIT + 1);
  if (filters.branch) query = query.eq("branch_id", filters.branch);
  if (filters.source) query = query.eq("first_source_id", filters.source);
  if (filters.owner === "me") query = query.eq("owner_id", userId);
  else if (filters.owner === "unassigned") query = query.is("owner_id", null);
  else if (filters.owner) query = query.eq("owner_id", filters.owner);

  const { data, error } = await query.returns<LeadRow[]>();
  if (error) throw new Error(`Could not load the board: ${error.message}`);
  const rows = (data ?? []).slice(0, BOARD_LIMIT);
  const customers = await customersById(rows.map((l) => l.customer_id));
  return { items: rows.map((l) => toListItem(l, customers)), truncated: (data ?? []).length > BOARD_LIMIT };
}

const NONE = ["00000000-0000-0000-0000-000000000000"];

/** Open, unarchived leads with no owner: the assignment queue, oldest first. */
export async function listUnassignedLeads(businessId: string, openStatusIds: string[], limit = 100) {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("leads")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("business_id", businessId)
    .is("owner_id", null)
    .is("archived_at", null)
    .in("status_id", openStatusIds.length ? openStatusIds : NONE)
    .order("created_at", { ascending: true })
    .limit(limit)
    .returns<LeadRow[]>();
  if (error) throw new Error(`Could not load unassigned leads: ${error.message}`);
  const customers = await customersById((data ?? []).map((l) => l.customer_id));
  return { total: count ?? 0, items: (data ?? []).map((l) => toListItem(l, customers)) };
}

/** How many open leads are waiting for an owner (dashboard). */
export async function countUnassignedLeads(businessId: string, openStatusIds: string[]) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .is("owner_id", null)
    .is("archived_at", null)
    .in("status_id", openStatusIds.length ? openStatusIds : NONE);
  return count ?? 0;
}

export type LeadActivity = {
  id: number;
  type: string;
  body: string | null;
  meta: Record<string, unknown>;
  actorId: string | null;
  occurredAt: string;
};

export type LeadDetail = LeadListItem & {
  description: string | null;
  customerId: string;
  latestSourceId: string | null;
  firstCampaign: string | null;
  latestCampaign: string | null;
  firstTouch: Record<string, string>;
  latestTouch: Record<string, string>;
  customFields: CustomValues;
  createdBy: string | null;
  lostReasonId: string | null;
  lostNote: string | null;
  closedAt: string | null;
  activities: LeadActivity[];
};

export async function getLead(id: string): Promise<LeadDetail | null> {
  const supabase = await createClient();
  const { data: l, error } = await supabase
    .from("leads")
    .select(
      `${LIST_COLUMNS}, description, latest_source_id, first_campaign, latest_campaign, first_touch, latest_touch, custom_fields, created_by, lost_reason_id, lost_note, closed_at`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load lead: ${error.message}`);
  if (!l) return null;

  const [customers, { data: acts, error: actError }] = await Promise.all([
    customersById([l.customer_id]),
    supabase
      .from("lead_activities")
      .select("id, type, body, meta, actor_id, occurred_at")
      .eq("lead_id", id)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(200),
  ]);
  if (actError) throw new Error(`Could not load lead activity: ${actError.message}`);

  return {
    ...toListItem(l as LeadRow, customers),
    customerId: l.customer_id,
    description: l.description,
    latestSourceId: l.latest_source_id,
    firstCampaign: l.first_campaign,
    latestCampaign: l.latest_campaign,
    firstTouch: l.first_touch ?? {},
    latestTouch: l.latest_touch ?? {},
    customFields: l.custom_fields ?? {},
    createdBy: l.created_by,
    lostReasonId: l.lost_reason_id,
    lostNote: l.lost_note,
    closedAt: l.closed_at,
    activities: (acts ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      body: a.body,
      meta: a.meta ?? {},
      actorId: a.actor_id,
      occurredAt: a.occurred_at,
    })),
  };
}

/** Leads for one customer file (CIF profile). */
export async function listCustomerLeads(customerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(LIST_COLUMNS)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .returns<LeadRow[]>();
  if (error) throw new Error(`Could not load leads: ${error.message}`);
  return (data ?? []).map((l) => ({
    id: l.id,
    leadNumber: l.lead_number,
    title: l.title,
    expectedValue: l.expected_value,
    statusId: l.status_id,
    sourceId: l.first_source_id,
    ownerId: l.owner_id,
    createdAt: l.created_at,
    archivedAt: l.archived_at,
  }));
}
