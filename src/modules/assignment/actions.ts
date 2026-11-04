"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";

const uuid = z.uuid();
const optionalId = z
  .union([z.uuid(), z.literal("")])
  .nullish()
  .transform((v) => v || null);

export async function setRoundRobin(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("leads.assign");
    const enabled = form.get("enabled") === "true";
    const supabase = await createClient();
    const { error } = await supabase
      .from("lead_assignment_settings")
      .upsert(
        { business_id: ctx.business.businessId, round_robin_enabled: enabled, updated_by: ctx.user.id },
        { onConflict: "business_id" },
      );
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return {
      ok: true,
      message: enabled
        ? "Round-robin is on. New leads without an owner are handed out in turn."
        : "Round-robin is off. New leads without an owner wait in the unassigned queue.",
    };
  });
}

export async function addToRotation(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("leads.assign");
    const userId = uuid.safeParse(form.get("userId"));
    if (!userId.success) return { ok: false, message: "Choose a person." };
    const branchId = optionalId.parse(form.get("branchId"));
    const supabase = await createClient();
    const { error } = await supabase.from("round_robin_members").insert({
      business_id: ctx.business.businessId,
      branch_id: branchId,
      user_id: userId.data,
    });
    if (error) {
      // RLS refuses people who couldn't see leads in that branch.
      if (error.code === "42501") {
        return { ok: false, message: "That person can't see leads in this branch, so they can't be in its rotation." };
      }
      return { ok: false, message: friendlyDbError(error) };
    }
    refresh();
    return { ok: true, message: "Added to the rotation." };
  });
}

export async function setRotationMemberActive(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("leads.assign");
    const id = uuid.parse(form.get("memberId"));
    const active = form.get("active") === "true";
    const supabase = await createClient();
    const { error } = await supabase
      .from("round_robin_members")
      .update({ is_active: active })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: active ? "Back in the rotation." : "Paused. They keep their current leads." };
  });
}

export async function removeFromRotation(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("leads.assign");
    const id = uuid.parse(form.get("memberId"));
    const supabase = await createClient();
    const { error } = await supabase
      .from("round_robin_members")
      .delete()
      .eq("id", id)
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Removed from the rotation." };
  });
}

/** Unassigned queue: one lead to one person. */
export async function assignLead(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("leads.assign");
    const leadId = uuid.parse(form.get("leadId"));
    const ownerId = uuid.safeParse(form.get("ownerId"));
    if (!ownerId.success) return { ok: false, message: "Choose who should own this lead." };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leads")
      .update({ owner_id: ownerId.data })
      .eq("id", leadId)
      .eq("business_id", ctx.business.businessId)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "You can't assign this lead." };
    refresh();
    return { ok: true, message: "Assigned." };
  });
}

/** Unassigned queue: hand the selected (or all listed) leads out in rotation. */
export async function assignInRotation(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("leads.assign");
    const ids = form.getAll("leadIds").map(String).filter((v) => uuid.safeParse(v).success);
    if (!ids.length) return { ok: false, message: "Tick the leads to hand out." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("assign_leads_round_robin", {
      p_business_id: ctx.business.businessId,
      p_lead_ids: ids,
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    const n = Number(data ?? 0);
    refresh();
    if (n === 0) {
      return { ok: false, message: "Nobody in the rotation can take these leads. Add people under Settings → Assignment." };
    }
    return {
      ok: true,
      message: n === ids.length ? `Assigned ${n} lead${n === 1 ? "" : "s"}.` : `Assigned ${n} of ${ids.length}. Nobody in the rotation can see the rest.`,
    };
  });
}
