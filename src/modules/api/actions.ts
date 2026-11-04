"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, fieldErrors, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/modules/tenancy/session";
import { guard } from "@/modules/tenancy/guard";
import { API_SCOPE_KEYS } from "./scopes";

export async function createApiKey(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const parsed = z
      .object({
        name: z.string().trim().min(1, "Name the key, e.g. Website.").max(60),
        scopes: z.array(z.enum(API_SCOPE_KEYS)).min(1, "Choose what the key may do."),
      })
      .safeParse({ name: form.get("name"), scopes: form.getAll("scopes") });
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_api_key", {
      p_business_id: ctx.business.businessId,
      p_name: parsed.data.name,
      p_scopes: parsed.data.scopes,
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return {
      ok: true,
      message: "Copy this key now. It won't be shown again.",
      data: { key: data as string },
    };
  });
}

export async function revokeApiKey(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const id = z.uuid().parse(form.get("keyId"));
    const supabase = await createClient();
    const { error } = await supabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Key revoked. Requests using it now fail." };
  });
}
