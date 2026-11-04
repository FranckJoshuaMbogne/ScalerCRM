"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, echo, fieldErrors, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { moveId, uniqueKey } from "@/modules/pipeline/board";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";
import { toScaled } from "./money";
import { listOrderStages } from "./queries";

const PERMISSION = "settings.orders.manage" as const;
const uuid = z.uuid();

const done = (message: string): ActionState => {
  refresh();
  return { ok: true, message };
};

const amount = (label: string, max?: bigint) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, "") || "0")
    .refine((v) => {
      const n = toScaled(v, 2);
      return n !== null && n >= BigInt(0) && (max === undefined || n <= max);
    }, label);

const itemSchema = z.object({
  itemId: z.union([z.uuid(), z.literal("")]).optional(),
  name: z.string().trim().min(1, "Name the item.").max(120),
  kind: z.enum(["product", "service"]),
  sku: z.string().trim().max(40).optional(),
  category: z.string().trim().max(60).optional(),
  unitPrice: amount("Enter a price like 1250 or 1250.50."),
  taxRate: amount("Tax must be between 0 and 100.", BigInt(10000)),
});

export async function saveCatalogItem(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const parsed = itemSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;
    const row = {
      name: d.name,
      kind: d.kind,
      sku: d.sku || null,
      category: d.category || null,
      unit_price: d.unitPrice,
      tax_rate: d.taxRate,
    };
    const supabase = await createClient();
    const { error } = d.itemId
      ? await supabase.from("catalog_items").update(row).eq("id", d.itemId).eq("business_id", ctx.business.businessId)
      : await supabase.from("catalog_items").insert({ ...row, business_id: ctx.business.businessId });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    return done(d.itemId ? "Item saved." : `${d.name} added to the catalogue.`);
  });
}

async function setActive(table: "catalog_items" | "order_stages" | "measurement_templates", form: FormData, labels: [string, string]) {
  const ctx = await requirePermission(PERMISSION);
  const id = uuid.parse(form.get("id"));
  const active = form.get("active") === "true";
  const supabase = await createClient();
  const { error } = await supabase.from(table).update({ is_active: active }).eq("id", id).eq("business_id", ctx.business.businessId);
  if (error) return { ok: false, message: friendlyDbError(error) };
  return done(active ? labels[0] : labels[1]);
}

export async function setCatalogItemActive(_: ActionState, form: FormData) {
  return guard(() => setActive("catalog_items", form, ["Item is back in the catalogue.", "Item hidden. Past orders keep it."]));
}
export async function setOrderStageActive(_: ActionState, form: FormData) {
  return guard(() => setActive("order_stages", form, ["Stage is back in use.", "Stage hidden. Order history keeps it."]));
}
export async function setTemplateActive(_: ActionState, form: FormData) {
  return guard(() => setActive("measurement_templates", form, ["Template is back in use.", "Template hidden. Saved measurements keep it."]));
}

const stageSchema = z.object({
  stageId: z.union([z.uuid(), z.literal("")]).optional(),
  name: z.string().trim().min(1, "Name the stage.").max(60),
  category: z.enum(["open", "done", "cancelled"]).optional(),
});

export async function saveOrderStage(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const parsed = stageSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;
    const supabase = await createClient();
    if (d.stageId) {
      const { error } = await supabase
        .from("order_stages")
        .update({ name: d.name })
        .eq("id", d.stageId)
        .eq("business_id", ctx.business.businessId);
      if (error) return { ok: false, message: friendlyDbError(error) };
      return done("Stage renamed.");
    }
    const existing = await listOrderStages(ctx.business.businessId);
    const { error } = await supabase.from("order_stages").insert({
      business_id: ctx.business.businessId,
      key: uniqueKey(d.name, existing.map((s) => s.key)),
      name: d.name,
      category: d.category ?? "open",
      position: Math.max(0, ...existing.map((s) => s.position)) + 1,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    return done(`${d.name} added. Move it into place with the arrows.`);
  });
}

export async function moveOrderStageConfig(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const id = uuid.parse(form.get("id"));
    const direction = z.enum(["up", "down"]).parse(form.get("direction"));
    const stages = await listOrderStages(ctx.business.businessId);
    const order = moveId(stages.map((s) => s.id), id, direction);
    const supabase = await createClient();
    for (const [i, stageId] of order.entries()) {
      const stage = stages.find((s) => s.id === stageId);
      if (stage && stage.position !== i + 1) {
        const { error } = await supabase.from("order_stages").update({ position: i + 1 }).eq("id", stageId);
        if (error) return { ok: false, message: friendlyDbError(error) };
      }
    }
    refresh();
    return {};
  });
}

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

const templateSchema = z.object({
  templateId: z.union([z.uuid(), z.literal("")]).optional(),
  garment: z.string().trim().min(1, "Name the garment.").max(60),
  fields: z.string().trim().min(1, "List at least one measurement."),
});

/** Fields are typed one per line ("Chest", "Sleeve length"); keys are derived and kept stable. */
export async function saveMeasurementTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const parsed = templateSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;
    const labels = [...new Set(d.fields.split(/\r?\n|,/).map((l) => l.trim()).filter(Boolean))].slice(0, 40);
    const supabase = await createClient();
    // Existing keys keep their labels' keys so saved readings stay attached.
    let previous: { key: string; label: string }[] = [];
    if (d.templateId) {
      const { data } = await supabase.from("measurement_templates").select("fields").eq("id", d.templateId).maybeSingle();
      previous = (data?.fields as { key: string; label: string }[] | undefined) ?? [];
    }
    const taken: string[] = [];
    const fields = labels.map((label) => {
      const known = previous.find((p) => p.label.toLowerCase() === label.toLowerCase());
      const key = known?.key ?? uniqueKey(label, [...previous.map((p) => p.key), ...taken]).replace(/^(\d)/, "m_$1");
      taken.push(key);
      return { key: KEY.test(key) ? key : `m_${taken.length}`, label: label.slice(0, 60) };
    });
    const row = { garment: d.garment, fields };
    const { error } = d.templateId
      ? await supabase.from("measurement_templates").update(row).eq("id", d.templateId).eq("business_id", ctx.business.businessId)
      : await supabase.from("measurement_templates").insert({ ...row, business_id: ctx.business.businessId, position: 99 });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    return done(d.templateId ? "Template saved." : `${d.garment} template added.`);
  });
}
