"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { type ActionState, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { guard } from "@/modules/tenancy/guard";
import { ACTIVE_BUSINESS_COOKIE, getMemberships, requirePermission } from "@/modules/tenancy/session";
import { isStep } from "./steps";

/** Choose the industry: reshapes the pipeline, then on to the next step. */
export async function chooseTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  let next = false;
  const result = await guard(async () => {
    const ctx = await requirePermission("settings.business.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("apply_industry_template", {
      p_business_id: ctx.business.businessId,
      p_template_key: String(form.get("template") ?? ""),
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    next = true;
    return { ok: true };
  });
  if (next) redirect("/setup");
  return result;
}

/** "Continue" (done) or "Skip for now" (skipped) on a step. */
export async function markStep(_: ActionState, form: FormData): Promise<ActionState> {
  let next = false;
  const result = await guard(async () => {
    const ctx = await requirePermission("settings.business.manage");
    const step = form.get("step");
    if (!isStep(step)) return { ok: false, message: "Unknown step." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("onboarding_mark", {
      p_business_id: ctx.business.businessId,
      p_step: step,
      p_value: form.get("value") === "skipped" ? "skipped" : "done",
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    next = true;
    return { ok: true };
  });
  if (next) redirect("/setup");
  return result;
}

export async function finishSetup(): Promise<ActionState> {
  let done = false;
  const result = await guard(async () => {
    const ctx = await requirePermission("settings.business.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("onboarding_mark", { p_business_id: ctx.business.businessId, p_step: "complete" });
    if (error) return { ok: false, message: friendlyDbError(error) };
    done = true;
    return { ok: true };
  });
  if (done) redirect("/dashboard");
  return result;
}

export async function dismissChecklist(): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("settings.business.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("onboarding_mark", { p_business_id: ctx.business.businessId, p_step: "dismiss" });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Hidden. Setup is always in Settings." };
  });
}

const COOKIE = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 31_536_000 };

/** A separate demo business full of sample data, opened straight away. */
export async function createDemo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_demo_business", {
    p_template_key: String(form.get("template") || "tailoring"),
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, String(data), COOKIE);
  redirect("/dashboard");
}

/** Deletes the demo business and goes back to a real one. */
export async function deleteDemo(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("businessId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_demo_business", { p_business_id: id });
  if (error) return { ok: false, message: friendlyDbError(error) };
  const real = (await getMemberships()).find((m) => m.businessId !== id);
  const jar = await cookies();
  if (real) jar.set(ACTIVE_BUSINESS_COOKIE, real.businessId, COOKIE);
  else jar.delete(ACTIVE_BUSINESS_COOKIE);
  redirect(real ? "/dashboard" : "/onboarding");
}
