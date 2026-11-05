"use server";

import { refresh } from "next/cache";
import { type ActionState, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";

/** Lets SCALER support view the business, read-only, for a few hours. */
export async function grantSupportAccess(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("settings.business.manage");
    const hours = Number(form.get("hours") ?? 24);
    const supabase = await createClient();
    const { error } = await supabase.rpc("grant_support_access", {
      p_business_id: ctx.business.businessId,
      p_hours: hours,
      p_reason: String(form.get("reason") ?? "").slice(0, 300),
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: `SCALER support can view your business for ${hours} hours. You can end it any time.` };
  });
}

export async function revokeSupportAccess(): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("settings.business.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_support_access", { p_business_id: ctx.business.businessId });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Support access ended." };
  });
}
