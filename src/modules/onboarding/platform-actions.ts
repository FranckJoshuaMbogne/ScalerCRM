"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/modules/plans/platform";

export async function reviewWhatsapp(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const id = z.uuid().safeParse(form.get("accountId"));
  if (!id.success) return { ok: false, message: "Unknown number." };
  const approve = form.get("decision") === "approve";
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_review_whatsapp", {
    p_account_id: id.data,
    p_approve: approve,
    p_note: String(form.get("note") ?? "").slice(0, 300),
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: approve ? "Approved. The business can send templates and campaigns." : "Rejected. The business sees why." };
}
