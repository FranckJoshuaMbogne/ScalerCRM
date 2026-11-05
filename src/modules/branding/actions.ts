"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, friendlyDbError } from "@/lib/forms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalisePhone } from "@/modules/crm/phone";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";
import type { CountryCode } from "libphonenumber-js";
import { checkHostname, imageType, readableWithWhite } from "./brand";
import { addEmailDomain, addHostDomain, checkEmailDomain, checkHostDomain, removeEmailDomainAtProvider, removeHostDomain } from "./providers";

const PERMISSION = "branding.manage" as const;
const MAX_IMAGE = 512 * 1024;

const brandSchema = z.object({
  appName: z.string().trim().min(1, "Name the app.").max(40),
  shortName: z.string().trim().min(1, "Give a short name for the home screen.").max(12, "The short name is at most 12 characters."),
  primaryColor: z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, "Choose a colour."),
  sidebarColor: z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, "Choose a colour."),
  supportEmail: z.union([z.literal(""), z.email("Enter a valid email.")]),
  supportPhone: z.string().trim().max(40),
  signinHeadline: z.string().trim().max(120),
  signinTagline: z.string().trim().max(300),
  hidePoweredBy: z.boolean(),
});

export async function saveBrand(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const parsed = brandSchema.safeParse({
      ...Object.fromEntries(["appName", "shortName", "primaryColor", "sidebarColor", "supportEmail", "supportPhone", "signinHeadline", "signinTagline"].map((k) => [k, String(form.get(k) ?? "")])),
      hidePoweredBy: form.get("hidePoweredBy") === "on",
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const d = parsed.data;
    for (const [label, colour] of [["The main colour", d.primaryColor], ["The sidebar colour", d.sidebarColor]] as const) {
      if (!readableWithWhite(colour)) return { ok: false, message: `${label} is too light: white text on it would be hard to read. Pick a darker shade.` };
    }
    const phone = d.supportPhone ? normalisePhone(d.supportPhone, ctx.business.countryCode as CountryCode) : null;
    if (d.supportPhone && !phone) return { ok: false, message: "The support phone number isn't valid." };
    const row = {
      app_name: d.appName,
      short_name: d.shortName,
      primary_color: d.primaryColor,
      sidebar_color: d.sidebarColor,
      support_email: d.supportEmail || null,
      support_phone: phone,
      signin_headline: d.signinHeadline || null,
      signin_tagline: d.signinTagline || null,
      hide_powered_by: d.hidePoweredBy,
      updated_by: ctx.user.id,
    };
    const supabase = await createClient();
    const { data: existing } = await supabase.from("business_brands").select("business_id").eq("business_id", ctx.business.businessId).maybeSingle();
    const { error } = existing
      ? await supabase.from("business_brands").update(row).eq("business_id", ctx.business.businessId)
      : await supabase.from("business_brands").insert({ ...row, business_id: ctx.business.businessId });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Brand saved. Everyone in the business sees it now." };
  });
}

export async function uploadBrandImage(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const kind = z.enum(["logo", "icon"]).parse(form.get("kind"));
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose an image." };
    if (file.size > MAX_IMAGE) return { ok: false, message: "Use an image under 512 KB." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = imageType(bytes);
    if (!type) return { ok: false, message: "Use a PNG or WebP image (SVG isn't accepted)." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_brand_asset", {
      p_business_id: ctx.business.businessId,
      p_kind: kind,
      p_content_type: type,
      p_base64: Buffer.from(bytes).toString("base64"),
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: kind === "logo" ? "Logo saved." : "App icon saved. Phones pick it up when the app is next installed." };
  });
}

export async function removeBrandImage(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const kind = z.enum(["logo", "icon"]).parse(form.get("kind"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_brand_asset", { p_business_id: ctx.business.businessId, p_kind: kind });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Removed." };
  });
}

/** Adds the domain here and with the hosting provider, and shows the DNS records. */
export async function addDomain(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const raw = String(form.get("hostname") ?? "");
    const problem = checkHostname(raw);
    if (problem) return { ok: false, message: problem };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("add_custom_domain", { p_business_id: ctx.business.businessId, p_hostname: raw });
    if (error) return { ok: false, message: friendlyDbError(error) };
    const domain = data as { id: string; hostname: string };
    const result = await addHostDomain(domain.hostname);
    await createAdminClient().rpc("record_custom_domain", { p_id: domain.id, p_status: result.status, p_instructions: result.instructions, p_error: result.error });
    refresh();
    return { ok: true, message: "Domain added. Add the DNS record below at your domain provider; it goes live once that's in place." };
  });
}

export async function checkDomain(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const id = z.uuid().parse(form.get("id"));
    const supabase = await createClient();
    const { data } = await supabase.from("custom_domains").select("id, hostname").eq("id", id).eq("business_id", ctx.business.businessId).maybeSingle();
    if (!data) return { ok: false, message: "Domain not found." };
    const result = await checkHostDomain(data.hostname);
    await createAdminClient().rpc("record_custom_domain", { p_id: data.id, p_status: result.status, p_instructions: result.instructions, p_error: result.error });
    refresh();
    return result.status === "active"
      ? { ok: true, message: `${data.hostname} is live, with HTTPS.` }
      : { ok: false, message: result.error ?? "Not yet: the DNS record isn't visible. DNS changes can take up to a few hours." };
  });
}

export async function removeDomain(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("remove_custom_domain", { p_business_id: ctx.business.businessId, p_id: z.uuid().parse(form.get("id")) });
    if (error) return { ok: false, message: friendlyDbError(error) };
    await removeHostDomain(String(data));
    refresh();
    return { ok: true, message: "Domain removed." };
  });
}

export async function setSenderDomain(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const domain = String(form.get("domain") ?? "").trim().toLowerCase();
    const local = String(form.get("fromLocal") ?? "hello").trim().toLowerCase() || "hello";
    if (checkHostname(domain)) return { ok: false, message: "Enter your email domain, e.g. yourbrand.in." };
    if (!/^[a-z0-9][a-z0-9._-]{0,40}$/.test(local)) return { ok: false, message: "The part before @ can use letters, numbers, dots and dashes." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_email_domain", { p_business_id: ctx.business.businessId, p_domain: domain, p_from_local: local });
    if (error) return { ok: false, message: friendlyDbError(error) };
    const result = await addEmailDomain(domain);
    await createAdminClient().rpc("record_email_domain", {
      p_business_id: ctx.business.businessId,
      p_provider_id: result.providerId,
      p_status: result.status,
      p_records: result.records,
      p_error: result.error,
    });
    refresh();
    return { ok: true, message: "Add the DNS records below; emails switch to your address once Resend has verified them." };
  });
}

export async function checkSenderDomain(): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const supabase = await createClient();
    const { data } = await supabase.from("email_domains").select("provider_id").eq("business_id", ctx.business.businessId).maybeSingle();
    if (!data?.provider_id) return { ok: false, message: "Email isn't connected yet, so this can't be checked." };
    const result = await checkEmailDomain(data.provider_id);
    await createAdminClient().rpc("record_email_domain", {
      p_business_id: ctx.business.businessId,
      p_provider_id: result.providerId,
      p_status: result.status,
      p_records: result.records.length ? result.records : null,
      p_error: result.error,
    });
    refresh();
    return result.status === "verified" ? { ok: true, message: "Verified: emails now go from your domain." } : { ok: false, message: "Not verified yet. DNS changes can take a few hours." };
  });
}

export async function removeSenderDomain(): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission(PERMISSION);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("remove_email_domain", { p_business_id: ctx.business.businessId });
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (data) await removeEmailDomainAtProvider(String(data));
    refresh();
    return { ok: true, message: "Emails go from SCALER's address again, with your app name." };
  });
}
