"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, echo, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";
import { TRIGGERS } from "./definitions";
import { type Graph, graphErrors, MAX_NODES, newNode } from "./graph";

const PERMISSION = "automation.manage" as const;

const graphSchema = z.object({ nodes: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_NODES) });

function parseGraph(raw: unknown): Graph | null {
  const parsed = graphSchema.safeParse(typeof raw === "string" ? safeJson(raw) : raw);
  return parsed.success ? (parsed.data as unknown as Graph) : null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Starts a new workflow: the chosen trigger and one task, as a draft. */
export async function createWorkflow(_: ActionState, form: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const parsed = z
      .object({
        name: z.string().trim().min(1, "Name the workflow.").max(120),
        trigger: z.enum(Object.keys(TRIGGERS) as [keyof typeof TRIGGERS, ...(keyof typeof TRIGGERS)[]]),
      })
      .safeParse({ name: form.get("name"), trigger: form.get("trigger") });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message, values: echo(form) };
    const graph: Graph = {
      nodes: [
        { id: "t", kind: "trigger", trigger: parsed.data.trigger, config: parsed.data.trigger === "lead_idle" ? { days: 3 } : {}, next: "n2", x: 0, y: 0 },
        newNode("action", "n2", 0, 140),
      ],
    };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_automation", {
      p_business_id: ctx.business.businessId,
      p_name: parsed.data.name,
      p_graph: graph,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    return { ok: true, data: { id: data as string } };
  });
  if (result.ok && result.data?.id) redirect(`/automation/${result.data.id}`);
  return result;
}

export type EditorResult = { ok: boolean; message: string; errors?: string[] };

/** Saves the canvas as a draft. Running workflows are not affected. */
export async function saveWorkflowDraft(id: string, graph: Graph, name: string): Promise<EditorResult> {
  const ctx = await requirePermission(PERMISSION).catch(() => null);
  if (!ctx) return { ok: false, message: "You can't edit automation." };
  const g = parseGraph(graph);
  if (!g) return { ok: false, message: "The workflow could not be read." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_automation_draft", { p_automation_id: z.uuid().parse(id), p_graph: g, p_name: name.slice(0, 120) });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Draft saved. Publish it to use it." };
}

/** Publishes the canvas as a new version. */
export async function publishWorkflow(id: string, graph: Graph, name: string, note: string): Promise<EditorResult> {
  const ctx = await requirePermission(PERMISSION).catch(() => null);
  if (!ctx) return { ok: false, message: "You can't edit automation." };
  const g = parseGraph(graph);
  if (!g) return { ok: false, message: "The workflow could not be read." };
  const errors = graphErrors(g);
  if (errors.length) return { ok: false, message: "Fix these before publishing.", errors };
  const supabase = await createClient();
  const saved = await supabase.rpc("save_automation_draft", { p_automation_id: z.uuid().parse(id), p_graph: g, p_name: name.slice(0, 120) });
  if (saved.error) return { ok: false, message: friendlyDbError(saved.error) };
  const { data, error } = await supabase.rpc("publish_automation", { p_automation_id: id, p_graph: g, p_note: note.slice(0, 200) || null });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: `Published as version ${(data as { version: number }).version}. Runs already going finish on the version they started.` };
}

export async function rollbackWorkflow(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await requirePermission(PERMISSION);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rollback_automation", {
      p_automation_id: z.uuid().parse(form.get("id")),
      p_version_id: z.uuid().parse(form.get("versionId")),
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: `Rolled back: now version ${(data as { version: number }).version}.` };
  });
}

export type DryRunStep = { node: string; kind: string; outcome: string; summary: string; action?: string };
export type DryRun = { steps: DryRunStep[]; ended: string; errors: string[] };

/** What would happen for a lead, without doing any of it. */
export async function dryRunWorkflow(id: string, leadId: string, graph: Graph): Promise<DryRun | { error: string }> {
  const ctx = await requirePermission(PERMISSION).catch(() => null);
  if (!ctx) return { error: "You can't edit automation." };
  const g = parseGraph(graph);
  if (!g) return { error: "The workflow could not be read." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("automation_dry_run", {
    p_automation_id: z.uuid().parse(id),
    p_entity_type: "lead",
    p_entity_id: z.uuid().parse(leadId),
    p_graph: g,
  });
  if (error) return { error: friendlyDbError(error) };
  const d = data as { steps: DryRunStep[]; ended?: string; errors?: string[] };
  return { steps: d.steps ?? [], ended: d.ended ?? "done", errors: d.errors ?? [] };
}

export async function setAutomationActive(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const active = form.get("active") === "true";
    const supabase = await createClient();
    const { error } = await supabase
      .from("automations")
      .update({ is_active: active })
      .eq("id", z.uuid().parse(form.get("id")))
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: active ? "On. It applies to events from now on." : "Off. Waiting runs are skipped." };
  });
}

export async function deleteAutomation(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("automations")
      .delete()
      .eq("id", z.uuid().parse(form.get("id")))
      .eq("business_id", ctx.business.businessId)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "Ready-made automations can be switched off but not deleted." };
    redirect("/automation");
  });
}

export async function retryRuns(): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("retry_automation_runs", { p_business_id: ctx.business.businessId });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: `${data} run${data === 1 ? "" : "s"} will be retried within 5 minutes.` };
  });
}

const ruleSchema = z.object({
  label: z.string().trim().min(1, "Describe the rule.").max(80),
  field: z.enum(["source_key", "stage", "has_email", "expected_value_gte", "activity_count_gte", "has_appointment", "active_within_days", "branch_id"]),
  value: z.string().trim().max(60).optional(),
  points: z.coerce.number().int().min(-100).max(100),
});

export async function addScoringRule(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const parsed = ruleSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message, values: echo(form) };
    const supabase = await createClient();
    const { error } = await supabase.from("lead_scoring_rules").insert({ ...parsed.data, value: parsed.data.value || null, business_id: ctx.business.businessId });
    if (error) return { ok: false, message: friendlyDbError(error) };
    await supabase.rpc("rescore_leads", { p_business_id: ctx.business.businessId });
    refresh();
    return { ok: true, message: "Rule added and every open lead rescored." };
  });
}

export async function removeScoringRule(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const supabase = await createClient();
    const { error } = await supabase.from("lead_scoring_rules").delete().eq("id", z.uuid().parse(form.get("id"))).eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    await supabase.rpc("rescore_leads", { p_business_id: ctx.business.businessId });
    refresh();
    return { ok: true, message: "Rule removed and leads rescored." };
  });
}
