"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, echo, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";
import { type Action, type Condition, TRIGGERS, validateAutomation } from "./definitions";

const PERMISSION = "automation.manage" as const;

/** The builder posts conditions and actions as JSON. */
function readJson<T>(form: FormData, key: string): T[] {
  try {
    const v = JSON.parse(String(form.get(key) ?? "[]"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function saveAutomation(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const id = String(form.get("automationId") ?? "");
    const trigger = String(form.get("trigger") ?? "");
    const triggerConfig: Record<string, unknown> = {};
    if (trigger === "lead_idle") triggerConfig.days = Number(form.get("idleDays") ?? 3);
    if (trigger === "lead_status_changed" && form.get("statusKey")) triggerConfig.status_key = String(form.get("statusKey"));
    if (trigger === "order_stage_changed" && form.get("stageKey")) triggerConfig.stage_key = String(form.get("stageKey"));
    const def = {
      name: String(form.get("name") ?? "").trim(),
      trigger,
      triggerConfig,
      conditions: readJson<Condition>(form, "conditions"),
      actions: readJson<Action>(form, "actions"),
    };
    const errors = validateAutomation(def);
    if (errors.length) return { ok: false, message: errors.join(" "), values: echo(form) };

    const row = {
      name: def.name,
      description: String(form.get("description") ?? "").trim().slice(0, 500) || null,
      trigger_config: def.triggerConfig,
      conditions: def.conditions,
      actions: def.actions,
    };
    const supabase = await createClient();
    if (id) {
      const { error } = await supabase.from("automations").update(row).eq("id", z.uuid().parse(id)).eq("business_id", ctx.business.businessId);
      if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
      refresh();
      return { ok: true, message: "Automation saved." };
    }
    if (!(trigger in TRIGGERS)) return { ok: false, message: "Choose what starts it." };
    const { error } = await supabase.from("automations").insert({
      ...row,
      business_id: ctx.business.businessId,
      trigger,
      is_active: false,
      created_by: ctx.user.id,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    redirect("/automation?saved=1");
  });
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
