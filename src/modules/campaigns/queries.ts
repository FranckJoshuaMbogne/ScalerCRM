import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TemplateComponents } from "./template";

export type Template = {
  id: string;
  wabaId: string;
  name: string;
  language: string;
  category: string;
  components: TemplateComponents;
  variableCount: number;
  status: "draft" | "pending" | "approved" | "rejected" | "paused" | "disabled";
  rejectedReason: string | null;
  submittedAt: string | null;
  syncedAt: string | null;
};

export async function listTemplates(businessId: string): Promise<Template[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("whatsapp_templates")
    .select("id, waba_id, name, language, category, components, variable_count, status, rejected_reason, submitted_at, synced_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load templates: ${error.message}`);
  return (data ?? []).map((t) => ({
    id: t.id,
    wabaId: t.waba_id,
    name: t.name,
    language: t.language,
    category: t.category,
    components: t.components,
    variableCount: t.variable_count,
    status: t.status,
    rejectedReason: t.rejected_reason,
    submittedAt: t.submitted_at,
    syncedAt: t.synced_at,
  }));
}

export type WhatsAppAccount = { id: string; wabaId: string; label: string; provider: string; status: string };

export async function listAccounts(businessId: string): Promise<WhatsAppAccount[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_accounts")
    .select("id, waba_id, display_phone, verified_name, provider, status")
    .eq("business_id", businessId)
    .neq("status", "disconnected");
  return (data ?? []).map((a) => ({
    id: a.id,
    wabaId: a.waba_id,
    provider: a.provider,
    status: a.status,
    label: [a.verified_name, a.display_phone].filter(Boolean).join(" · ") || (a.provider === "dialog360" ? "360dialog number" : `WABA ${a.waba_id}`),
  }));
}

export type CampaignFilter = {
  branch_id?: string;
  tag_ids?: string[];
  lead_source_ids?: string[];
  lead_status_ids?: string[];
  owner_id?: string;
  has_orders?: boolean;
  no_order_days?: number;
  min_lifetime_value?: string;
  created_within_days?: number;
  birthday_month?: number;
};

export type Campaign = {
  id: string;
  name: string;
  accountId: string | null;
  templateId: string | null;
  variables: { source: string; value?: string }[];
  headerMediaUrl: string | null;
  filter: CampaignFilter;
  ratePerMinute: number;
  status: "draft" | "scheduled" | "sending" | "paused" | "completed" | "cancelled";
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

const COLUMNS =
  "id, name, account_id, template_id, variables, header_media_url, filter, rate_per_minute, status, scheduled_at, started_at, completed_at, created_at";

type Row = {
  id: string;
  name: string;
  account_id: string | null;
  template_id: string | null;
  variables: Campaign["variables"];
  header_media_url: string | null;
  filter: CampaignFilter;
  rate_per_minute: number;
  status: Campaign["status"];
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

const toCampaign = (c: Row): Campaign => ({
  id: c.id,
  name: c.name,
  accountId: c.account_id,
  templateId: c.template_id,
  variables: c.variables ?? [],
  headerMediaUrl: c.header_media_url,
  filter: c.filter ?? {},
  ratePerMinute: c.rate_per_minute,
  status: c.status,
  scheduledAt: c.scheduled_at,
  startedAt: c.started_at,
  completedAt: c.completed_at,
  createdAt: c.created_at,
});

export async function listCampaigns(businessId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<Row[]>();
  if (error) throw new Error(`Could not load campaigns: ${error.message}`);
  return (data ?? []).map(toCampaign);
}

export async function getCampaign(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("campaigns").select(COLUMNS).eq("id", id).maybeSingle<Row>();
  if (error) throw new Error(`Could not load campaign: ${error.message}`);
  return data ? toCampaign(data) : null;
}

export type Report = {
  recipients: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  replied: number;
  leads: number;
  orders: number;
  revenue: string;
};

export async function getReport(id: string): Promise<Report | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("campaign_report", { p_campaign_id: id });
  return data ? { ...(data as Report), revenue: String((data as Report).revenue ?? "0") } : null;
}

export async function listCampaignEvents(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaign_events")
    .select("id, type, detail, actor_id, created_at")
    .eq("campaign_id", id)
    .order("created_at");
  return (data ?? []).map((e) => ({ id: e.id as number, type: e.type as string, detail: e.detail as Record<string, unknown> | null, actorId: e.actor_id as string | null, createdAt: e.created_at as string }));
}

export async function listFailures(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaign_recipients")
    .select("id, phone, status, last_error, customer_id")
    .eq("campaign_id", id)
    .in("status", ["failed", "skipped"])
    .limit(50);
  return (data ?? []) as { id: string; phone: string; status: string; last_error: string | null; customer_id: string }[];
}

export type Suppression = { id: string; phone: string; reason: string; note: string | null; createdAt: string };

export async function listSuppressions(businessId: string): Promise<Suppression[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppressions")
    .select("id, phone, reason, note, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(500);
  return (data ?? []).map((s) => ({ id: s.id, phone: s.phone, reason: s.reason, note: s.note, createdAt: s.created_at }));
}
