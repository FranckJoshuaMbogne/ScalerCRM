"use server";

import type { CountryCode } from "libphonenumber-js";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, echo, fieldErrors, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { normalisePhone } from "@/modules/crm/phone";
import { readCustomFields } from "@/modules/custom-fields/engine";
import { listFieldDefinitions } from "@/modules/custom-fields/queries";
import { can, requirePermission } from "@/modules/tenancy/session";
import { guard } from "@/modules/tenancy/guard";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .optional();

const optionalId = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .transform((v) => v || null);

const money = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/,/g, "") : null))
  .refine((v) => v === null || /^\d{1,12}(\.\d{1,2})?$/.test(v), "Enter an amount like 25000 or 25000.50.");

const createSchema = z.object({
  customerId: optionalId,
  phone: optionalText(40),
  email: z.union([z.email("Enter a valid email address.").trim().toLowerCase(), z.literal("")]).optional(),
  fullName: optionalText(160),
  sourceId: z.uuid("Choose where this lead came from."),
  statusId: optionalId,
  branchId: optionalId,
  ownerId: optionalId,
  title: optionalText(160),
  description: optionalText(4000),
  expectedValue: money,
  campaign: optionalText(200),
});

export async function createLead(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("leads.create");
    const parsed = createSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;
    const invalid = (errors: Record<string, string>): ActionState => ({
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: errors,
      values: echo(form),
    });

    const phone = d.phone ? normalisePhone(d.phone, ctx.business.countryCode as CountryCode) : null;
    if (!d.customerId) {
      if (d.phone && !phone) return invalid({ phone: "That doesn't look like a valid phone number." });
      if (!phone && !d.email) return invalid({ phone: "Enter a phone number or an email." });
      if (!d.fullName) return invalid({ fullName: "Enter the customer's name." });
    }

    const defs = await listFieldDefinitions(ctx.business.businessId, "lead");
    const custom = readCustomFields(defs, form);
    if (Object.keys(custom.errors).length) {
      return invalid(custom.errors);
    }

    const contact = d.customerId ? { customer_id: d.customerId } : { phone, email: d.email || null, full_name: d.fullName };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_lead", {
      p_business_id: ctx.business.businessId,
      p_input: {
        ...contact,
        source_id: d.sourceId,
        status_id: d.statusId,
        branch_id: d.branchId,
        owner_id: can(ctx, "leads.assign") ? d.ownerId : null,
        title: d.title,
        description: d.description,
        expected_value: d.expectedValue,
        campaign: d.campaign,
        custom_fields: custom.values,
      },
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };

    const r = data as { lead_id: string; customer_created: boolean; matched_on: string | null };
    const params = new URLSearchParams({ created: "1" });
    if (d.customerId) params.set("existing", "1");
    else if (!r.customer_created && r.matched_on) params.set("matched", r.matched_on);
    redirect(`/leads/${r.lead_id}?${params}`);
  });
}

const updateSchema = z.object({
  leadId: z.uuid(),
  title: optionalText(160),
  description: optionalText(4000),
  expectedValue: money,
  branchId: optionalId,
  ownerId: optionalId,
});

export async function updateLead(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("leads.edit");
    const parsed = updateSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;

    const defs = await listFieldDefinitions(ctx.business.businessId, "lead");
    const custom = readCustomFields(defs, form);
    if (Object.keys(custom.errors).length) {
      return { ok: false, message: "Check the highlighted fields.", fieldErrors: custom.errors };
    }

    const supabase = await createClient();
    // Keep values of fields that were deactivated since the lead was saved.
    const { data: current } = await supabase.from("leads").select("custom_fields").eq("id", d.leadId).maybeSingle();
    const activeKeys = new Set(defs.map((f) => f.key));
    const kept = Object.fromEntries(Object.entries(current?.custom_fields ?? {}).filter(([k]) => !activeKeys.has(k)));

    const row: Record<string, unknown> = {
      title: d.title,
      description: d.description,
      expected_value: d.expectedValue,
      branch_id: d.branchId,
      custom_fields: { ...kept, ...custom.values },
    };
    if (can(ctx, "leads.assign") && form.has("ownerId")) row.owner_id = d.ownerId;

    const { data, error } = await supabase
      .from("leads")
      .update(row)
      .eq("id", d.leadId)
      .eq("business_id", ctx.business.businessId)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "You can't edit this lead." };
    refresh();
    return { ok: true, message: "Lead saved." };
  });
}

export async function changeLeadStatus(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("leads.edit");
    const leadId = z.uuid().parse(form.get("leadId"));
    const statusId = z.uuid().parse(form.get("statusId"));
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leads")
      .update({ status_id: statusId })
      .eq("id", leadId)
      .eq("business_id", ctx.business.businessId)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "You can't change this lead." };
    refresh();
    return { ok: true, message: "Status updated." };
  });
}

const activitySchema = z.object({
  leadId: z.uuid(),
  type: z.enum(["note", "call", "whatsapp", "email", "meeting", "visit"]),
  body: z.string().trim().min(1, "Write what happened.").max(4000),
});

export async function logLeadActivity(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("leads.edit");
    const parsed = activitySchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const supabase = await createClient();
    const { error } = await supabase.from("lead_activities").insert({
      business_id: ctx.business.businessId,
      lead_id: parsed.data.leadId,
      type: parsed.data.type,
      body: parsed.data.body,
      actor_id: ctx.user.id,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    refresh();
    return { ok: true, message: "Added to the timeline." };
  });
}

export async function setLeadArchived(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("leads.delete");
    const leadId = z.uuid().parse(form.get("leadId"));
    const archive = form.get("archive") === "true";
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leads")
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq("id", leadId)
      .eq("business_id", ctx.business.businessId)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "You can't change this lead." };
    refresh();
    return { ok: true, message: archive ? "Lead archived. Its history is kept." : "Lead restored." };
  });
}
