"use server";

import { createHash, randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, friendlyDbError } from "@/lib/forms";
import { siteOrigin } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";
import { getPage, googleConfigured, listUserPages, subscribePage, tokenExpiry } from "./ads/clients";

const digits = (label: string) => z.string().trim().regex(/^\d{3,30}$/, `${label}: digits only.`);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function connectPage(businessId: string, pageId: string, token: string, name?: string): Promise<ActionState> {
  const page = await getPage(pageId, token);
  if (!page.ok) return { ok: false, message: `Meta refused the page details: ${page.error}` };
  const subscribed = await subscribePage(pageId, token);
  const supabase = await createClient();
  const { error } = await supabase.rpc("connect_meta_page", {
    p_business_id: businessId,
    p_input: {
      page_id: pageId,
      name: page.value.name ?? name ?? null,
      access_token: token,
      expires_at: await tokenExpiry(token),
      subscribed: subscribed.ok,
    },
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  return {
    ok: true,
    message: subscribed.ok
      ? `${page.value.name ?? "Page"} is connected. New Lead Ads leads arrive automatically.`
      : `Connected, but Meta didn't subscribe the page to lead webhooks (${subscribed.error}). The token needs pages_manage_metadata.`,
  };
}

export async function connectPageManually(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const parsed = z.object({ pageId: digits("Page ID"), token: z.string().trim().min(20, "Paste the page access token.") }).safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const result = await connectPage(ctx.business.businessId, parsed.data.pageId, parsed.data.token);
    refresh();
    return result;
  });
}

/** After Facebook Login: list the pages the user manages (names only reach the browser). */
export async function listPages(userToken: string) {
  await requirePermission("integrations.manage");
  const r = await listUserPages(userToken);
  return r.ok ? { ok: true as const, pages: (r.value.data ?? []).map((p) => ({ id: p.id, name: p.name })) } : { ok: false as const, error: r.error };
}

export async function connectPagesFromLogin(userToken: string, pageIds: string[]): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const r = await listUserPages(userToken);
    if (!r.ok) return { ok: false, message: `Meta refused: ${r.error}` };
    const chosen = (r.value.data ?? []).filter((p) => pageIds.includes(p.id));
    if (!chosen.length) return { ok: false, message: "Pick at least one page." };
    const results = [];
    for (const p of chosen) results.push(await connectPage(ctx.business.businessId, p.id, p.access_token, p.name));
    refresh();
    const failed = results.filter((x) => !x.ok);
    return failed.length ? failed[0] : { ok: true, message: `${chosen.length} page${chosen.length === 1 ? "" : "s"} connected.` };
  });
}

const adSchema = z.object({
  platform: z.enum(["meta", "google"]),
  externalId: z.string().trim().transform((v) => v.replace(/^act_/, "").replace(/-/g, "")).pipe(digits("Account ID")),
  name: z.string().trim().max(80).optional(),
  token: z.string().trim().min(20, "Paste the full token."),
  loginCustomerId: z.string().trim().transform((v) => v.replace(/-/g, "")).pipe(z.union([z.string().regex(/^\d{10}$/, "Manager account ID has 10 digits."), z.literal("")])).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional().or(z.literal("")),
});

export async function connectAdAccount(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const parsed = adSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.platform === "google" && !googleConfigured()) {
      return { ok: false, message: "This server needs GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first." };
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("connect_ad_account", {
      p_business_id: ctx.business.businessId,
      p_input: {
        platform: d.platform,
        external_id: d.externalId,
        name: d.name || null,
        token: d.token,
        login_customer_id: d.loginCustomerId || null,
        currency: d.currency || ctx.business.currency,
        expires_at: d.platform === "meta" ? await tokenExpiry(d.token) : null,
      },
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Connected. Spend for the last 30 days arrives with the next background run." };
  });
}

/** Creates a Google lead form webhook; the URL and key are shown once. */
export async function createGoogleWebhook(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const name = z.string().trim().min(1, "Name it, e.g. the campaign.").max(80).safeParse(form.get("name"));
    if (!name.success) return { ok: false, message: name.error.issues[0].message };
    const token = randomBytes(24).toString("base64url");
    const key = randomBytes(18).toString("base64url");
    const supabase = await createClient();
    const { error } = await supabase.from("lead_webhooks").insert({
      business_id: ctx.business.businessId,
      name: name.data,
      url_token_hash: sha(token),
      secret_hash: sha(key),
      created_by: ctx.user.id,
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return {
      ok: true,
      message: "Paste these into the lead form's webhook settings in Google Ads. They're shown only once.",
      data: { link: `${await siteOrigin()}/api/webhooks/google-leads/${token}`, key },
    };
  });
}

export async function disconnectIntegration(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await requirePermission("integrations.manage");
    const kind = z.enum(["meta_page", "ad_account", "lead_webhook"]).parse(form.get("kind"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("disconnect_integration", { p_kind: kind, p_id: z.uuid().parse(form.get("id")) });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Disconnected. Leads already received are kept." };
  });
}

export async function retryFailed(): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("retry_failed_events", { p_business_id: ctx.business.businessId });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: `${data} event${data === 1 ? "" : "s"} queued again. They're retried within 5 minutes.` };
  });
}

const TARGET = /^(full_name|first_name|last_name|phone|email|note|ignore|custom:[a-z][a-z0-9_]{0,39})$/;

export async function saveFormMapping(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const id = z.uuid().parse(form.get("formId"));
    const mapping: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      if (k.startsWith("map:") && typeof v === "string" && TARGET.test(v)) mapping[k.slice(4)] = v;
    }
    const source = String(form.get("sourceId") ?? "");
    const branch = String(form.get("branchId") ?? "");
    const supabase = await createClient();
    const { error } = await supabase
      .from("lead_forms")
      .update({ mapping, source_id: source || null, branch_id: branch || null })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Mapping saved. It applies to the next leads from this form." };
  });
}

export async function saveAttributionSettings(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("analytics.marketing");
    const model = z.enum(["first_touch", "last_touch", "linear"]).parse(form.get("model"));
    const lookback = z.coerce.number().int().min(1).max(365).catch(90).parse(form.get("lookbackDays"));
    const supabase = await createClient();
    const { error } = await supabase
      .from("attribution_settings")
      .upsert({ business_id: ctx.business.businessId, model, lookback_days: lookback, updated_by: ctx.user.id }, { onConflict: "business_id" });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Attribution policy saved." };
  });
}
