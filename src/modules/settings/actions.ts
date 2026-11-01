"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, fieldErrors, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { PermissionError, requirePermission } from "@/modules/tenancy/session";

async function guard(fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, message: e.message };
    throw e;
  }
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .optional();

const businessSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name.").max(120),
  legalName: optional(160),
  industry: optional(80),
  countryCode: z.string().trim().toUpperCase().length(2, "Use a 2-letter country code, e.g. IN."),
  currency: z.string().trim().toUpperCase().length(3, "Use a 3-letter currency code, e.g. INR."),
  timezone: z.string().trim().min(3, "Enter a time zone, e.g. Asia/Kolkata."),
});

export async function updateBusiness(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("settings.business.manage");
    const parsed = businessSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;
    if (!Intl.supportedValuesOf("timeZone").includes(d.timezone) && d.timezone !== "UTC") {
      return { ok: false, fieldErrors: { timezone: "Unknown time zone." }, message: "Check the highlighted fields." };
    }
    const supabase = await createClient();
    const { error } = await supabase
      .from("businesses")
      .update({
        name: d.name,
        legal_name: d.legalName ?? null,
        industry: d.industry ?? null,
        country_code: d.countryCode,
        currency: d.currency,
        timezone: d.timezone,
      })
      .eq("id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Business details saved." };
  });
}

const branchSchema = z.object({
  branchId: z.uuid().optional().or(z.literal("")),
  name: z.string().trim().min(2, "Name the branch.").max(120),
  code: optional(20),
  phone: optional(30),
  addressLine: optional(200),
  city: optional(80),
  state: optional(80),
  postalCode: optional(20),
});

export async function saveBranch(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("settings.branches.manage");
    const parsed = branchSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const { branchId, ...d } = parsed.data;
    const row = {
      name: d.name,
      code: d.code ?? null,
      phone: d.phone ?? null,
      address_line: d.addressLine ?? null,
      city: d.city ?? null,
      state: d.state ?? null,
      postal_code: d.postalCode ?? null,
    };
    const supabase = await createClient();
    const { error } = branchId
      ? await supabase.from("branches").update(row).eq("id", branchId).eq("business_id", ctx.business.businessId)
      : await supabase.from("branches").insert({ ...row, business_id: ctx.business.businessId });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: branchId ? "Branch saved." : `Added ${d.name}.` };
  });
}

export async function setBranchActive(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("settings.branches.manage");
    const id = z.uuid().parse(form.get("branchId"));
    const active = form.get("active") === "true";
    const supabase = await createClient();
    const { error } = await supabase
      .from("branches")
      .update({ is_active: active })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: active ? "Branch reopened." : "Branch closed. Its history is kept." };
  });
}
