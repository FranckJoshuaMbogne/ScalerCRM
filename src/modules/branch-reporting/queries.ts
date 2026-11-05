import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Pack, PackKind } from "./pack";
import type { TargetMetric, TargetPeriod } from "./targets";

export type BranchRow = {
  branch_id: string | null;
  branch_name: string;
  leads: number;
  won: number;
  lost: number;
  conversion_rate: number | null;
  expected_won: number | null;
  performance_index: number | null;
  median_days_to_win: number | null;
  orders: number;
  revenue: string | null;
  average_order_value: string | null;
  collected: string | null;
  outstanding: string | null;
  walk_ins: number;
  appointments: number;
  no_show_rate: number | null;
  tasks_overdue: number;
};

export async function getBranchComparison(businessId: string, from: string, to: string): Promise<BranchRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("branch_comparison", { p_business_id: businessId, p_from: from, p_to: to });
  if (error) return [];
  return (data ?? []) as BranchRow[];
}

export type TeamRow = {
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

export async function getTeamPerformance(businessId: string, branchId: string, from: string, to: string): Promise<TeamRow[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_performance", { p_business_id: businessId, p_branch_id: branchId, p_from: from, p_to: to, p_min_age_days: 7 });
  if (error) return null;
  return (data ?? []) as TeamRow[];
}

export type TransferRow = {
  from_branch_id: string | null;
  from_branch: string;
  to_branch_id: string | null;
  to_branch: string;
  transfers: number;
  won: number;
  median_days_to_close: number | null;
  senders: string | null;
  closers: string | null;
};

export async function getTransferReport(businessId: string, from: string, to: string): Promise<TransferRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transfer_report", { p_business_id: businessId, p_from: from, p_to: to });
  if (error) return [];
  return (data ?? []) as TransferRow[];
}

export type TargetProgress = {
  id: string;
  scope: "business" | "branch" | "person";
  branch_id: string | null;
  branch_name: string | null;
  user_id: string | null;
  person_name: string | null;
  period_type: TargetPeriod;
  period_start: string;
  period_end: string;
  metric: TargetMetric;
  target: number;
  actual: number;
  percent: number;
  expected_percent: number;
};

export async function getTargetProgress(businessId: string, opts: { on?: string; mineOnly?: boolean } = {}): Promise<TargetProgress[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("target_progress", {
    p_business_id: businessId,
    p_on: opts.on ?? null,
    p_mine_only: opts.mineOnly ?? false,
  });
  if (error) return [];
  return ((data ?? []) as TargetProgress[]).map((t) => ({ ...t, target: Number(t.target), actual: Number(t.actual), percent: Number(t.percent), expected_percent: Number(t.expected_percent) }));
}

export type LeaderRow = {
  user_id: string;
  name: string;
  branch_name: string | null;
  conversions: number;
  revenue: string;
  collections: string;
  leads_handled: number;
  rank_conversions: number;
  rank_revenue: number;
};

/** Null when the leaderboard is off for this person. */
export async function getLeaderboard(businessId: string, from: string, to: string): Promise<LeaderRow[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("leaderboard", { p_business_id: businessId, p_from: from, p_to: to });
  if (error) return null;
  return (data ?? []) as LeaderRow[];
}

export async function leaderboardEnabled(businessId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("businesses").select("leaderboard_enabled").eq("id", businessId).maybeSingle();
  return Boolean(data?.leaderboard_enabled);
}

export async function getPack(businessId: string, kind: PackKind, branchId: string | null, from: string, to: string): Promise<Pack | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_pack", { p_business_id: businessId, p_kind: kind, p_branch_id: branchId, p_from: from, p_to: to });
  if (error) return null;
  return data as Pack;
}

/** Branches this person may report on (all of them with all-branch access). */
export async function reportBranches(businessId: string): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("branches").select("id, name").eq("business_id", businessId).order("name");
  return (data ?? []).map((b) => ({ id: b.id, name: b.name }));
}
