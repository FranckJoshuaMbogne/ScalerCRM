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
import { requirePermission } from "@/modules/tenancy/session";
import { guard } from "@/modules/tenancy/guard";
import { ATTACHMENT_BUCKET } from "./queries";

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

const invalid = (form: FormData | undefined, errors: Record<string, string>): ActionState => ({
  ok: false,
  message: "Check the highlighted fields.",
  fieldErrors: errors,
  values: form ? echo(form) : undefined,
});

// ------------------------------------------------------------- create
const createSchema = z.object({
  fullName: z.string().trim().min(1, "Enter the customer's name.").max(160),
  phone: optionalText(40),
  email: z.union([z.email("Enter a valid email address.").trim().toLowerCase(), z.literal("")]).optional(),
  branchId: optionalId,
});

export async function createCustomer(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.create");
    const parsed = createSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;
    const phone = d.phone ? normalisePhone(d.phone, ctx.business.countryCode as CountryCode) : null;
    if (d.phone && !phone) return invalid(form, { phone: "That doesn't look like a valid phone number." });
    if (!phone && !d.email) return invalid(form, { phone: "Enter a phone number or an email." });

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("find_or_create_customer", {
      p_business_id: ctx.business.businessId,
      p_phone: phone,
      p_email: d.email || null,
      p_full_name: d.fullName,
      p_branch_id: d.branchId,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    const r = data as { customer_id: string; created: boolean; matched_on: string | null; cif_number: string; visible: boolean };
    if (!r.visible) {
      return {
        ok: false,
        message: `This ${r.matched_on ?? "contact"} already belongs to ${r.cif_number}, which is assigned to someone else. Ask a manager for access.`,
        values: echo(form),
      };
    }
    redirect(`/customers/${r.customer_id}${r.created ? "?created=1" : `?matched=${r.matched_on}`}`);
  });
}

// ------------------------------------------------------------- identity
const updateSchema = z.object({
  customerId: z.uuid(),
  fullName: z.string().trim().min(1, "Enter the customer's name.").max(160),
  gender: z.enum(["", "female", "male", "other"]).transform((v) => v || null),
  dateOfBirth: z
    .union([z.iso.date("Enter a valid date."), z.literal("")])
    .optional()
    .transform((v) => v || null),
  preferredLanguage: optionalText(40),
  branchId: optionalId,
});

export async function updateCustomer(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.edit");
    const parsed = updateSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;
    const defs = await listFieldDefinitions(ctx.business.businessId, "customer");
    const custom = readCustomFields(defs, form);
    if (Object.keys(custom.errors).length) return invalid(undefined, custom.errors);

    const supabase = await createClient();
    const { data: current } = await supabase.from("customers").select("custom_fields").eq("id", d.customerId).maybeSingle();
    const activeKeys = new Set(defs.map((f) => f.key));
    const kept = Object.fromEntries(Object.entries(current?.custom_fields ?? {}).filter(([k]) => !activeKeys.has(k)));

    const { data, error } = await supabase
      .from("customers")
      .update({
        full_name: d.fullName,
        gender: d.gender,
        date_of_birth: d.dateOfBirth,
        preferred_language: d.preferredLanguage ?? null,
        branch_id: d.branchId,
        custom_fields: { ...kept, ...custom.values },
      })
      .eq("id", d.customerId)
      .eq("business_id", ctx.business.businessId)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "You can't edit this customer." };
    refresh();
    return { ok: true, message: "Customer saved." };
  });
}

// ------------------------------------------------------------- contacts
export async function addContact(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.edit");
    const customerId = z.uuid().parse(form.get("customerId"));
    const kind = z.enum(["phone", "email"]).parse(form.get("kind"));
    const raw = String(form.get("value") ?? "").trim();
    const label = String(form.get("label") ?? "").trim().slice(0, 40) || null;

    let value: string | null;
    if (kind === "phone") {
      value = normalisePhone(raw, ctx.business.countryCode as CountryCode);
      if (!value) return invalid(form, { value: "That doesn't look like a valid phone number." });
    } else {
      const parsed = z.email().safeParse(raw.toLowerCase());
      if (!parsed.success) return invalid(form, { value: "Enter a valid email address." });
      value = parsed.data;
    }

    const supabase = await createClient();
    const { error } = await supabase.from("customer_contacts").insert({
      business_id: ctx.business.businessId,
      customer_id: customerId,
      kind,
      value,
      label,
      created_by: ctx.user.id,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    refresh();
    return { ok: true, message: kind === "phone" ? "Phone number added." : "Email added." };
  });
}

export async function removeContact(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.edit");
    const id = z.uuid().parse(form.get("contactId"));
    const customerId = z.uuid().parse(form.get("customerId"));
    const supabase = await createClient();
    const { count } = await supabase
      .from("customer_contacts")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId);
    if ((count ?? 0) <= 1) return { ok: false, message: "A customer needs at least one phone number or email." };
    const { error } = await supabase
      .from("customer_contacts")
      .delete()
      .eq("id", id)
      .eq("customer_id", customerId)
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Removed." };
  });
}

export async function makePrimaryContact(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.edit");
    const id = z.uuid().parse(form.get("contactId"));
    const customerId = z.uuid().parse(form.get("customerId"));
    const kind = z.enum(["phone", "email"]).parse(form.get("kind"));
    const supabase = await createClient();
    const { error: clearError } = await supabase
      .from("customer_contacts")
      .update({ is_primary: false })
      .eq("customer_id", customerId)
      .eq("kind", kind)
      .eq("business_id", ctx.business.businessId);
    if (clearError) return { ok: false, message: friendlyDbError(clearError) };
    const { error } = await supabase.from("customer_contacts").update({ is_primary: true }).eq("id", id);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Primary contact updated." };
  });
}

// ------------------------------------------------------------- addresses
const addressSchema = z.object({
  customerId: z.uuid(),
  label: optionalText(40),
  line1: z.string().trim().min(1, "Enter the address.").max(200),
  line2: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(20),
});

export async function addAddress(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.edit");
    const parsed = addressSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase.from("customer_addresses").insert({
      business_id: ctx.business.businessId,
      customer_id: d.customerId,
      label: d.label,
      line1: d.line1,
      line2: d.line2,
      city: d.city,
      state: d.state,
      postal_code: d.postalCode,
      country_code: ctx.business.countryCode,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    refresh();
    return { ok: true, message: "Address added." };
  });
}

export async function removeAddress(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.edit");
    const id = z.uuid().parse(form.get("addressId"));
    const supabase = await createClient();
    const { error } = await supabase
      .from("customer_addresses")
      .delete()
      .eq("id", id)
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Address removed." };
  });
}

// ------------------------------------------------------------- tags
export async function addTag(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.edit");
    const customerId = z.uuid().parse(form.get("customerId"));
    const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return invalid(form, { name: "Type a tag." });

    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("tags")
      .select("id, name")
      .eq("business_id", ctx.business.businessId)
      .ilike("name", name.replace(/[%_\\]/g, "\\$&"))
      .maybeSingle();
    let tagId = existing?.id as string | undefined;
    if (!tagId) {
      const { data, error } = await supabase
        .from("tags")
        .insert({ business_id: ctx.business.businessId, name })
        .select("id")
        .single();
      if (error) return { ok: false, message: friendlyDbError(error) };
      tagId = data.id;
    }
    const { error } = await supabase
      .from("customer_tags")
      .upsert({ business_id: ctx.business.businessId, customer_id: customerId, tag_id: tagId }, { ignoreDuplicates: true });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: `Tagged “${existing?.name ?? name}”.` };
  });
}

export async function removeTag(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await requirePermission("customers.edit");
    const customerId = z.uuid().parse(form.get("customerId"));
    const tagId = z.uuid().parse(form.get("tagId"));
    const supabase = await createClient();
    const { error } = await supabase.from("customer_tags").delete().eq("customer_id", customerId).eq("tag_id", tagId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Tag removed." };
  });
}

// ------------------------------------------------------------- consent
const consentSchema = z.object({
  customerId: z.uuid(),
  channel: z.enum(["whatsapp", "sms", "email", "call"]),
  purpose: z.enum(["marketing", "service"]),
  status: z.enum(["opted_in", "opted_out"]),
  evidence: optionalText(500),
});

export async function recordConsent(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.edit");
    const parsed = consentSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const d = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase.from("customer_consents").insert({
      business_id: ctx.business.businessId,
      customer_id: d.customerId,
      channel: d.channel,
      purpose: d.purpose,
      status: d.status,
      source: "manual",
      evidence: d.evidence,
      captured_by: ctx.user.id,
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Consent recorded." };
  });
}

// ------------------------------------------------------------- notes
export async function addCustomerNote(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.edit");
    const customerId = z.uuid().parse(form.get("customerId"));
    const body = String(form.get("body") ?? "").trim().slice(0, 4000);
    if (!body) return invalid(form, { body: "Write a note." });
    const supabase = await createClient();
    const { error } = await supabase.from("customer_events").insert({
      business_id: ctx.business.businessId,
      customer_id: customerId,
      type: "note",
      body,
      actor_id: ctx.user.id,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    refresh();
    return { ok: true, message: "Note added." };
  });
}

// ------------------------------------------------------------- attachments
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function safeFileName(name: string) {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(-100);
  return cleaned || "file";
}

export async function uploadAttachment(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.edit");
    const customerId = z.uuid().parse(form.get("customerId"));
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return invalid(undefined, { file: "Choose a file." });
    if (file.size > MAX_ATTACHMENT_BYTES) return invalid(undefined, { file: "Files can be up to 10 MB." });

    const supabase = await createClient();
    const path = `${ctx.business.businessId}/${customerId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadError) return { ok: false, message: `Upload failed: ${uploadError.message}` };

    const { error } = await supabase.from("customer_attachments").insert({
      business_id: ctx.business.businessId,
      customer_id: customerId,
      storage_path: path,
      file_name: file.name.slice(0, 200),
      content_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: ctx.user.id,
    });
    if (error) {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
      return { ok: false, message: friendlyDbError(error) };
    }
    refresh();
    return { ok: true, message: `Uploaded ${file.name}.` };
  });
}

export async function deleteAttachment(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("customers.edit");
    const id = z.uuid().parse(form.get("attachmentId"));
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customer_attachments")
      .delete()
      .eq("id", id)
      .eq("business_id", ctx.business.businessId)
      .select("storage_path");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (data?.[0]) await supabase.storage.from(ATTACHMENT_BUCKET).remove([data[0].storage_path]);
    refresh();
    return { ok: true, message: "File deleted." };
  });
}

// ------------------------------------------------------------- merge
export async function mergeCustomers(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await requirePermission("customers.merge");
    const survivorId = z.uuid().parse(form.get("survivorId"));
    const duplicateId = z.uuid().parse(form.get("duplicateId"));
    if (form.get("confirm") !== "yes") return { ok: false, message: "Tick the box to confirm the merge." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("merge_customers", { p_survivor_id: survivorId, p_duplicate_id: duplicateId });
    if (error) return { ok: false, message: friendlyDbError(error) };
    redirect(`/customers/${survivorId}?merged=1`);
  });
}
