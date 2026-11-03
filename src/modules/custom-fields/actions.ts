"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, fieldErrors, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/modules/tenancy/session";
import { guard } from "@/modules/tenancy/guard";
import { FIELD_TYPES, fieldKey, parseOptions } from "./engine";

const schema = z.object({
  fieldId: z.union([z.uuid(), z.literal("")]).optional(),
  entity: z.enum(["customer", "lead"]),
  label: z.string().trim().min(1, "Name the field.").max(60),
  type: z.enum(FIELD_TYPES),
  options: z.string().max(4000).optional(),
  helpText: z.string().trim().max(200).optional(),
});

export async function saveFieldDefinition(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("settings.custom_fields.manage");
    const parsed = schema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;
    const options = d.type === "select" || d.type === "multiselect" ? parseOptions(d.options ?? "") : [];
    if ((d.type === "select" || d.type === "multiselect") && options.length === 0) {
      return { ok: false, message: "Check the highlighted fields.", fieldErrors: { options: "Add at least one option." } };
    }
    const row = {
      label: d.label,
      field_type: d.type,
      options,
      is_required: form.get("required") === "on",
      help_text: d.helpText || null,
    };

    const supabase = await createClient();
    if (d.fieldId) {
      // Key and entity never change, so stored values stay attached.
      const { error } = await supabase
        .from("custom_field_definitions")
        .update(row)
        .eq("id", d.fieldId)
        .eq("business_id", ctx.business.businessId);
      if (error) return { ok: false, message: friendlyDbError(error) };
    } else {
      const { count } = await supabase
        .from("custom_field_definitions")
        .select("id", { count: "exact", head: true })
        .eq("business_id", ctx.business.businessId)
        .eq("entity", d.entity);
      const { error } = await supabase.from("custom_field_definitions").insert({
        ...row,
        business_id: ctx.business.businessId,
        entity: d.entity,
        key: fieldKey(d.label),
        position: (count ?? 0) + 1,
      });
      if (error) return { ok: false, message: friendlyDbError(error) };
    }
    refresh();
    return { ok: true, message: d.fieldId ? "Field saved." : `Added “${d.label}”.` };
  });
}

export async function setFieldActive(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("settings.custom_fields.manage");
    const id = z.uuid().parse(form.get("fieldId"));
    const active = form.get("active") === "true";
    const supabase = await createClient();
    const { error } = await supabase
      .from("custom_field_definitions")
      .update({ is_active: active })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: active ? "Field turned back on." : "Field hidden. Saved values are kept." };
  });
}
