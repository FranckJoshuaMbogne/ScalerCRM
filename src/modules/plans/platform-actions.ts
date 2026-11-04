"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { LIMITS } from "./limits";
import { requirePlatformAdmin } from "./platform";

const id = z.uuid();

/** Overrides come in as one field per limit; empty means "use the plan's". */
function readOverrides(form: FormData) {
  const out: Record<string, number> = {};
  for (const l of LIMITS) {
    const raw = String(form.get(`override_${l.key}`) ?? "").trim();
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return { error: `${l.label} must be a whole number.` };
    out[l.key] = n;
  }
  return { overrides: out };
}

export async function setBusinessPlan(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const businessId = id.safeParse(form.get("businessId"));
  if (!businessId.success) return { ok: false, message: "Unknown business." };
  const parsed = readOverrides(form);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  const trial = String(form.get("trialEndsAt") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_plan", {
    p_business_id: businessId.data,
    p_plan_key: String(form.get("planKey") ?? ""),
    p_overrides: parsed.overrides,
    p_trial_ends_at: trial ? new Date(`${trial}T23:59:59+05:30`).toISOString() : null,
    p_reason: String(form.get("reason") ?? "").trim(),
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Plan saved." };
}

export async function setBusinessStatus(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const businessId = id.safeParse(form.get("businessId"));
  if (!businessId.success) return { ok: false, message: "Unknown business." };
  const status = form.get("status") === "suspended" ? "suspended" : "active";
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_status", {
    p_business_id: businessId.data,
    p_status: status,
    p_reason: String(form.get("reason") ?? "").trim(),
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: status === "suspended" ? "Business suspended: read-only from now." : "Business reactivated." };
}

export async function savePlan(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const input: Record<string, string | boolean> = {
    name: String(form.get("name") ?? ""),
    description: String(form.get("description") ?? ""),
    is_public: form.get("isPublic") === "on",
    price_monthly: String(form.get("priceMonthly") ?? "").trim(),
    price_yearly: String(form.get("priceYearly") ?? "").trim(),
  };
  for (const l of LIMITS) input[l.key] = String(form.get(l.key) ?? "").trim();
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" && v && k !== "name" && k !== "description" && !/^\d+(\.\d{1,2})?$/.test(v)) {
      return { ok: false, message: "Limits and prices must be numbers (leave a limit empty for unlimited)." };
    }
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_save_plan", { p_key: String(form.get("key") ?? ""), p_input: input });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Plan saved." };
}
