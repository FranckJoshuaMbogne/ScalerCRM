import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Action, Condition } from "./definitions";

export type Automation = {
  id: string;
  name: string;
  description: string | null;
  trigger: string;
  triggerConfig: Record<string, unknown>;
  conditions: Condition[];
  actions: Action[];
  isActive: boolean;
  presetKey: string | null;
};

export async function listAutomations(businessId: string): Promise<Automation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("automations")
    .select("id, name, description, trigger, trigger_config, conditions, actions, is_active, preset_key")
    .eq("business_id", businessId)
    .order("created_at");
  return (data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    trigger: a.trigger,
    triggerConfig: a.trigger_config ?? {},
    conditions: a.conditions ?? [],
    actions: a.actions ?? [],
    isActive: a.is_active,
    presetKey: a.preset_key,
  }));
}

export type Run = {
  id: string;
  automationId: string;
  entityType: string;
  entityId: string;
  status: string;
  error: string | null;
  log: { at: string; step?: number; action?: string; ok?: boolean; error?: string; event?: string; reason?: string }[];
  createdAt: string;
};

export async function listRuns(businessId: string, status?: string): Promise<Run[]> {
  const supabase = await createClient();
  let q = supabase
    .from("automation_runs")
    .select("id, automation_id, entity_type, entity_id, status, error, log, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return (data ?? []).map((r) => ({
    id: r.id,
    automationId: r.automation_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    status: r.status,
    error: r.error,
    log: r.log ?? [],
    createdAt: r.created_at,
  }));
}

export type ScoringRule = { id: string; label: string; field: string; value: string | null; points: number; isActive: boolean };

export async function listScoringRules(businessId: string): Promise<ScoringRule[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lead_scoring_rules")
    .select("id, label, field, value, points, is_active")
    .eq("business_id", businessId)
    .order("points", { ascending: false });
  return (data ?? []).map((r) => ({ id: r.id, label: r.label, field: r.field, value: r.value, points: r.points, isActive: r.is_active }));
}
