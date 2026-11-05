import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MetricKey } from "./metrics";

export type Summary = Partial<Record<MetricKey, number | string | null>>;

export async function getSummary(businessId: string, from: string, to: string): Promise<Summary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("analytics_summary", { p_business_id: businessId, p_from: from, p_to: to });
  if (error) return null;
  return data as Summary;
}

export type BreakdownRow = {
  key: string;
  label: string;
  leads: number | null;
  won: number | null;
  conversion_rate: number | null;
  orders: number | null;
  revenue: string | null;
  spend: string | null;
};

export async function getBreakdown(businessId: string, from: string, to: string, dimension: string): Promise<BreakdownRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("analytics_breakdown", { p_business_id: businessId, p_from: from, p_to: to, p_dimension: dimension });
  if (error) return [];
  return (data ?? []) as BreakdownRow[];
}

export type PicRow = {
  owner_id: string | null;
  owner_name: string;
  leads: number;
  won: number;
  conversion_rate: number | null;
  expected_won: number | null;
  performance_index: number | null;
  open_overdue_tasks: number;
  median_days_to_win: number | null;
};

export async function getPicPerformance(businessId: string, from: string, to: string, minAgeDays = 7): Promise<PicRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pic_performance", { p_business_id: businessId, p_from: from, p_to: to, p_min_age_days: minAgeDays });
  if (error) return [];
  return (data ?? []) as PicRow[];
}

export type Operations = {
  by_stage: { stage: string; category: string; orders: number }[];
  overdue_deliveries: number;
  median_days_to_deliver: number | null;
  appointments_today: number;
};

export async function getOperations(businessId: string): Promise<Operations | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("operations_summary", { p_business_id: businessId });
  if (error) return null;
  return data as Operations;
}

export type SavedView = { id: string; name: string; query: string; shared: boolean; mine: boolean };

export async function listSavedViews(businessId: string, page: string, userId: string): Promise<SavedView[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("saved_views")
    .select("id, name, query, shared, user_id")
    .eq("business_id", businessId)
    .eq("page", page)
    .order("name");
  return (data ?? []).map((v) => ({ id: v.id, name: v.name, query: v.query, shared: v.shared, mine: v.user_id === userId }));
}

export async function listReportSchedules(businessId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("report_schedules")
    .select("id, report, frequency, next_run_at, last_sent_at, is_active, branch_id")
    .eq("business_id", businessId)
    .order("created_at");
  return data ?? [];
}
