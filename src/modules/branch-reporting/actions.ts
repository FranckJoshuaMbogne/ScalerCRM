"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";
import { periodStart } from "./targets";

const targetSchema = z
  .object({
    scope: z.enum(["business", "branch", "person"]),
    branchId: z.uuid().optional(),
    userId: z.uuid().optional(),
    periodType: z.enum(["month", "quarter"]),
    month: z.string().regex(/^\d{4}-\d{2}$/, "Choose the month."),
    metric: z.enum(["leads_handled", "conversions", "revenue", "collections"]),
    target: z.coerce.number().positive("Set a target above zero.").max(1e12),
  })
  .refine((v) => v.scope !== "branch" || v.branchId, { message: "Choose the branch.", path: ["branchId"] })
  .refine((v) => v.scope !== "person" || v.userId, { message: "Choose the person.", path: ["userId"] });

/** Sets a target, replacing any for the same who, period and measure. */
export async function saveTarget(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("targets.manage");
    const raw = Object.fromEntries([...form.entries()].filter(([, v]) => v !== ""));
    const parsed = targetSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const d = parsed.data;
    const value = d.metric === "revenue" || d.metric === "collections" ? Math.round(d.target * 100) / 100 : Math.round(d.target);
    const supabase = await createClient();
    const row = {
      business_id: ctx.business.businessId,
      scope: d.scope,
      branch_id: d.scope === "branch" ? d.branchId! : null,
      user_id: d.scope === "person" ? d.userId! : null,
      period_type: d.periodType,
      period_start: periodStart(`${d.month}-01`, d.periodType),
      metric: d.metric,
    };
    let existing = supabase.from("targets").select("id").match({ business_id: row.business_id, scope: row.scope, period_type: row.period_type, period_start: row.period_start, metric: row.metric });
    existing = row.branch_id ? existing.eq("branch_id", row.branch_id) : existing.is("branch_id", null);
    existing = row.user_id ? existing.eq("user_id", row.user_id) : existing.is("user_id", null);
    const { data: found } = await existing.maybeSingle();
    const { error } = found
      ? await supabase.from("targets").update({ target: value }).eq("id", found.id)
      : await supabase.from("targets").insert({ ...row, target: value, created_by: ctx.user.id });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: found ? "Target updated." : "Target set." };
  });
}

export async function deleteTarget(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("targets.manage");
    const supabase = await createClient();
    const { error } = await supabase.from("targets").delete().eq("id", z.uuid().parse(form.get("id"))).eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Target removed." };
  });
}

export async function setLeaderboard(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("settings.business.manage");
    const on = form.get("enabled") === "true";
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_leaderboard", { p_business_id: ctx.business.businessId, p_enabled: on });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: on ? "Leaderboard on: everyone in the business can see it." : "Leaderboard off." };
  });
}
