"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, echo, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";
import { listMeasurementTemplates } from "./queries";

const READING = /^\d{1,3}(\.\d{1,2})?$/;

/** Saves a new measurement session; earlier ones stay as history. */
export async function addMeasurement(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.edit");
    const customerId = z.uuid().parse(form.get("customerId"));
    const templateId = z.uuid().safeParse(form.get("templateId"));
    if (!templateId.success) return { ok: false, message: "Choose a garment." };
    const unit = form.get("unit") === "cm" ? "cm" : "in";
    const template = (await listMeasurementTemplates(ctx.business.businessId)).find((t) => t.id === templateId.data);
    if (!template) return { ok: false, message: "That garment template no longer exists." };

    const readings: Record<string, number> = {};
    const errors: Record<string, string> = {};
    for (const f of template.fields) {
      const raw = String(form.get(`m_${f.key}`) ?? "").trim();
      if (!raw) continue;
      if (!READING.test(raw)) errors[`m_${f.key}`] = "Use a number like 40 or 40.5.";
      else readings[f.key] = Number(raw);
    }
    if (Object.keys(errors).length) return { ok: false, message: "Check the highlighted fields.", fieldErrors: errors, values: echo(form) };
    if (!Object.keys(readings).length) return { ok: false, message: "Enter at least one measurement.", values: echo(form) };

    const notes = z.string().trim().max(2000).optional().parse(form.get("notes") ?? undefined);
    const supabase = await createClient();
    const { error } = await supabase.from("customer_measurements").insert({
      business_id: ctx.business.businessId,
      customer_id: customerId,
      garment: template.garment,
      unit,
      readings,
      notes: notes || null,
      taken_by: ctx.user.id,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    refresh();
    return { ok: true, message: `${template.garment} measurements saved.` };
  });
}
