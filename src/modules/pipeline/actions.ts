"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, echo, fieldErrors, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { listLostReasons, listSources, listStatuses } from "@/modules/leads/config";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";
import { moveId, uniqueKey } from "./board";

const PERMISSION = "settings.pipeline.manage" as const;
const OPEN_COLOURS = ["new", "contacted", "qualified", "negotiation"] as const;

const done = (message: string): ActionState => {
  refresh();
  return { ok: true, message };
};

// ------------------------------------------------------------------ stages

const stageSchema = z.object({
  stageId: z.union([z.uuid(), z.literal("")]).optional(),
  name: z.string().trim().min(1, "Give the stage a name.").max(60, "Keep it under 60 characters."),
  category: z.enum(["open", "won", "lost"]),
  colour: z.enum(OPEN_COLOURS).optional(),
  requiresOwner: z.literal("on").optional(),
});

export async function saveStage(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const parsed = stageSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;
    const row = {
      name: d.name,
      category: d.category,
      stage: d.category === "open" ? (d.colour ?? "new") : d.category,
      requires_owner: d.requiresOwner === "on",
    };
    const supabase = await createClient();
    const businessId = ctx.business.businessId;

    if (d.stageId) {
      const { data, error } = await supabase
        .from("lead_statuses")
        .update(row)
        .eq("id", d.stageId)
        .eq("business_id", businessId)
        .select("id");
      if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
      if (!data?.length) return { ok: false, message: "That stage couldn't be found." };
      return done("Stage saved.");
    }

    const existing = await listStatuses(businessId);
    const { error } = await supabase.from("lead_statuses").insert({
      ...row,
      business_id: businessId,
      key: uniqueKey(d.name, existing.map((s) => s.key)),
      position: Math.max(0, ...existing.map((s) => s.position)) + 1,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    return done(`${d.name} added at the end of the pipeline. Move it into place with the arrows.`);
  });
}

const idSchema = z.uuid();

export async function setStageActive(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const id = idSchema.parse(form.get("stageId"));
    const active = form.get("active") === "true";
    const supabase = await createClient();
    const { error } = await supabase
      .from("lead_statuses")
      .update({ is_active: active })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    return done(active ? "Stage is back in use." : "Stage hidden. Its history is kept.");
  });
}

export async function makeDefaultStage(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await requirePermission(PERMISSION);
    const id = idSchema.parse(form.get("stageId"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_default_lead_status", { p_status_id: id });
    if (error) return { ok: false, message: friendlyDbError(error) };
    return done("New leads now start in this stage.");
  });
}

const LISTS = {
  statuses: listStatuses,
  sources: listSources,
  lost_reasons: listLostReasons,
} as const;

/** Up/down arrows for stages, sources and lost reasons. */
export async function moveConfigItem(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const list = z.enum(["statuses", "sources", "lost_reasons"]).parse(form.get("list"));
    const id = idSchema.parse(form.get("id"));
    const direction = z.enum(["up", "down"]).parse(form.get("direction"));
    const items = await LISTS[list](ctx.business.businessId);
    const order = moveId(items.map((i) => i.id), id, direction);
    const supabase = await createClient();
    const { error } = await supabase.rpc("reorder_lead_config", {
      p_business_id: ctx.business.businessId,
      p_table: list,
      p_ids: order,
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return {};
  });
}

export async function saveTransitions(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await requirePermission(PERMISSION);
    const id = idSchema.parse(form.get("stageId"));
    const restricted = form.get("mode") === "some";
    const allowed = restricted ? form.getAll("allowed").map(String).filter((v) => idSchema.safeParse(v).success) : [];
    if (restricted && allowed.length === 0) {
      return { ok: false, message: "Tick at least one next stage, or choose 'Any stage'." };
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_lead_status_transitions", { p_status_id: id, p_to_ids: allowed });
    if (error) return { ok: false, message: friendlyDbError(error) };
    return done(restricted ? "Next stages saved." : "Leads can move from this stage to any stage.");
  });
}

// ------------------------------------------------------------------ lost reasons

const reasonSchema = z.object({
  reasonId: z.union([z.uuid(), z.literal("")]).optional(),
  name: z.string().trim().min(1, "Enter a reason.").max(80, "Keep it under 80 characters."),
});

export async function saveLostReason(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const parsed = reasonSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const { reasonId, name } = parsed.data;
    const supabase = await createClient();
    const businessId = ctx.business.businessId;
    if (reasonId) {
      const { error } = await supabase
        .from("lead_lost_reasons")
        .update({ name })
        .eq("id", reasonId)
        .eq("business_id", businessId);
      if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
      return done("Reason saved.");
    }
    const existing = await listLostReasons(businessId);
    const { error } = await supabase.from("lead_lost_reasons").insert({
      business_id: businessId,
      name,
      position: Math.max(0, ...existing.map((r) => r.position)) + 1,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    return done("Reason added.");
  });
}

export async function setLostReasonActive(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const id = idSchema.parse(form.get("reasonId"));
    const active = form.get("active") === "true";
    const supabase = await createClient();
    const { error } = await supabase
      .from("lead_lost_reasons")
      .update({ is_active: active })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    return done(active ? "Reason is back in the list." : "Reason hidden. Leads that used it keep it.");
  });
}

// ------------------------------------------------------------------ sources

const CHANNELS = ["meta", "google", "whatsapp", "website", "walk_in", "referral", "phone", "other"] as const;

const sourceSchema = z.object({
  sourceId: z.union([z.uuid(), z.literal("")]).optional(),
  name: z.string().trim().min(1, "Give the source a name.").max(60, "Keep it under 60 characters."),
  channel: z.enum(CHANNELS),
});

export async function saveSource(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const parsed = sourceSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;
    const supabase = await createClient();
    const businessId = ctx.business.businessId;
    if (d.sourceId) {
      const { error } = await supabase
        .from("lead_sources")
        .update({ name: d.name, channel: d.channel })
        .eq("id", d.sourceId)
        .eq("business_id", businessId);
      if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
      return done("Source saved.");
    }
    const existing = await listSources(businessId);
    const { error } = await supabase.from("lead_sources").insert({
      business_id: businessId,
      key: uniqueKey(d.name, existing.map((s) => s.key)),
      name: d.name,
      channel: d.channel,
      position: existing.length + 1,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    return done(`${d.name} added. Use its key in the lead API: ${uniqueKey(d.name, existing.map((s) => s.key))}.`);
  });
}

export async function setSourceActive(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const id = idSchema.parse(form.get("sourceId"));
    const active = form.get("active") === "true";
    const supabase = await createClient();
    const { error } = await supabase
      .from("lead_sources")
      .update({ is_active: active })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    return done(active ? "Source is back in the list." : "Source hidden from forms. Existing leads keep it.");
  });
}
