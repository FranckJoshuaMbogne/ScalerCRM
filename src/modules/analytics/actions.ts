"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { guard } from "@/modules/tenancy/guard";
import { getContext, requirePermission } from "@/modules/tenancy/session";
import { fromZoned, zonedParts } from "@/modules/tasks/schedule";

const PAGES = ["leads", "orders", "customers", "analytics"] as const;

export async function saveView(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await getContext();
    const page = z.enum(PAGES).parse(form.get("page"));
    const name = z.string().trim().min(1, "Name the view.").max(60).safeParse(form.get("name"));
    if (!name.success) return { ok: false, message: name.error.issues[0].message };
    // Only the filter part of the address is kept; never page numbers.
    const params = new URLSearchParams(String(form.get("query") ?? ""));
    params.delete("page");
    const supabase = await createClient();
    const { error } = await supabase.from("saved_views").insert({
      business_id: ctx.business.businessId,
      user_id: ctx.user.id,
      page,
      name: name.data,
      query: params.toString().slice(0, 2000),
      shared: form.get("shared") === "on",
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "View saved." };
  });
}

export async function deleteView(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const supabase = await createClient();
    const { error } = await supabase.from("saved_views").delete().eq("id", z.uuid().parse(form.get("id")));
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true };
  });
}

/** First send at 08:00 business time on the next day (daily), Monday (weekly) or the 1st (monthly). */
function firstRun(frequency: "daily" | "weekly" | "monthly", tz: string) {
  const now = new Date();
  const p = zonedParts(now, tz);
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (frequency === "daily") base.setUTCDate(base.getUTCDate() + 1);
  if (frequency === "weekly") base.setUTCDate(base.getUTCDate() + (((8 - base.getUTCDay()) % 7) || 7));
  if (frequency === "monthly") base.setUTCMonth(base.getUTCMonth() + 1, 1);
  return fromZoned({ year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate(), hour: 8, minute: 0 }, tz);
}

export async function scheduleReport(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("analytics.view");
    const report = z
      .enum(["executive", "marketing", "sales", "operations", "pack_owner", "pack_branch", "pack_marketing"])
      .parse(form.get("report"));
    const frequency = z.enum(["daily", "weekly", "monthly"]).parse(form.get("frequency"));
    // Packs are weekly or monthly; a branch manager's pack is for one branch.
    if (report.startsWith("pack_") && frequency === "daily") return { ok: false, message: "Packs come weekly or monthly." };
    const branchId = report === "pack_branch" ? z.uuid().safeParse(form.get("branchId")) : null;
    if (branchId && !branchId.success) return { ok: false, message: "Choose the branch for the pack." };
    const supabase = await createClient();
    const { error } = await supabase.from("report_schedules").insert({
      business_id: ctx.business.businessId,
      user_id: ctx.user.id,
      report,
      frequency,
      branch_id: branchId?.data ?? null,
      next_run_at: firstRun(frequency, ctx.business.timezone).toISOString(),
    });
    if (error) {
      return { ok: false, message: error.code === "23505" ? "You already get that report on that schedule." : friendlyDbError(error) };
    }
    refresh();
    return { ok: true, message: `Scheduled. It's emailed to ${ctx.user.email} at 8 am.` };
  });
}

export async function removeSchedule(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const supabase = await createClient();
    const { error } = await supabase.from("report_schedules").delete().eq("id", z.uuid().parse(form.get("id")));
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Stopped." };
  });
}
