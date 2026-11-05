import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Graph } from "./graph";

export type Automation = {
  id: string;
  name: string;
  description: string | null;
  trigger: string;
  triggerConfig: Record<string, unknown>;
  isActive: boolean;
  presetKey: string | null;
  hasDraft: boolean;
  version: number | null;
  graph: Graph | null;
};

export async function listAutomations(businessId: string): Promise<Automation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("automations")
    .select("id, name, description, trigger, trigger_config, is_active, preset_key, draft_graph, current_version_id, automation_versions!automations_current_version_fk(version, graph)")
    .eq("business_id", businessId)
    .order("created_at");
  return (data ?? []).map((a) => {
    const v = a.automation_versions as unknown as { version: number; graph: Graph } | { version: number; graph: Graph }[] | null;
    const current = Array.isArray(v) ? v[0] : v;
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      trigger: a.trigger,
      triggerConfig: a.trigger_config ?? {},
      isActive: a.is_active,
      presetKey: a.preset_key,
      hasDraft: a.draft_graph !== null,
      version: current?.version ?? null,
      graph: current?.graph ?? null,
    };
  });
}

export type Version = { id: string; version: number; note: string | null; createdAt: string; createdBy: string | null };

export type Workflow = Automation & { draftGraph: Graph | null; currentVersionId: string | null; versions: Version[] };

export async function getWorkflow(businessId: string, id: string): Promise<Workflow | null> {
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("automations")
    .select("id, name, description, trigger, trigger_config, is_active, preset_key, draft_graph, current_version_id")
    .eq("business_id", businessId)
    .eq("id", id)
    .maybeSingle();
  if (!a) return null;
  const { data: versions } = await supabase
    .from("automation_versions")
    .select("id, version, note, created_at, created_by, graph")
    .eq("automation_id", id)
    .order("version", { ascending: false });
  const current = (versions ?? []).find((v) => v.id === a.current_version_id);
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    trigger: a.trigger,
    triggerConfig: a.trigger_config ?? {},
    isActive: a.is_active,
    presetKey: a.preset_key,
    hasDraft: a.draft_graph !== null,
    version: current?.version ?? null,
    graph: (current?.graph as Graph) ?? null,
    draftGraph: a.draft_graph as Graph | null,
    currentVersionId: a.current_version_id,
    versions: (versions ?? []).map((v) => ({ id: v.id, version: v.version, note: v.note, createdAt: v.created_at, createdBy: v.created_by })),
  };
}

export type NodeStats = {
  reached: number;
  ok: number;
  failed: number;
  waiting: number;
  yes: number;
  no: number;
  replied: number;
  timeout: number;
  won_after_yes: number;
  won_after_no: number;
};
export type StepStats = { versionId: string | null; runs: number; failedRuns: number; nodes: Record<string, NodeStats> };

export async function workflowStats(id: string, versionId?: string): Promise<StepStats> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("automation_step_stats", { p_automation_id: id, p_version_id: versionId ?? null });
  if (error || !data) return { versionId: null, runs: 0, failedRuns: 0, nodes: {} };
  const d = data as { version_id: string | null; runs: number; failed_runs: number; nodes: Record<string, NodeStats> };
  return { versionId: d.version_id, runs: d.runs, failedRuns: d.failed_runs, nodes: d.nodes ?? {} };
}

/** Recent leads to try a dry run on. */
export async function recentLeads(businessId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("id, lead_number, customers(full_name)")
    .eq("business_id", businessId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(40);
  return (data ?? []).map((l) => {
    const c = l.customers as unknown as { full_name: string } | { full_name: string }[] | null;
    return { value: l.id, label: `${l.lead_number} · ${(Array.isArray(c) ? c[0]?.full_name : c?.full_name) ?? ""}` };
  });
}

export async function editorFields(businessId: string) {
  const supabase = await createClient();
  const [{ data: fields }, { data: endpoints }] = await Promise.all([
    supabase.from("custom_field_definitions").select("entity, key, label").eq("business_id", businessId).eq("is_active", true).order("position"),
    supabase.from("webhook_endpoints").select("id, url, description").eq("business_id", businessId).eq("is_active", true),
  ]);
  return {
    customFields: (fields ?? []).map((f) => ({ value: `${f.entity}:${f.key}`, label: `${f.entity === "lead" ? "Lead" : f.entity === "customer" ? "Customer" : "Order"}: ${f.label}` })),
    endpoints: (endpoints ?? []).map((e) => ({ value: e.id, label: e.description ? `${e.description} (${e.url})` : e.url })),
  };
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
