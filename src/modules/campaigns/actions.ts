"use server";

import type { CountryCode } from "libphonenumber-js";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { type ActionState, echo, friendlyDbError } from "@/lib/forms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalisePhone } from "@/modules/crm/phone";
import { providerFor } from "@/modules/integrations/whatsapp/providers";
import { uploadTemplateSample } from "@/modules/integrations/whatsapp/meta-cloud";
import { parseLocalInput } from "@/modules/tasks/schedule";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";
import type { CampaignFilter } from "./queries";
import { type Button, countVariables, type HeaderFormat, renderBody, type TemplateComponents, toProviderTemplate, toSendComponents, validateTemplate } from "./template";
import { runCampaigns } from "./worker";

const uuid = z.uuid();
const ids = (form: FormData, key: string) => form.getAll(key).map(String).filter((v) => uuid.safeParse(v).success);

// ------------------------------------------------------------------ templates

function readTemplate(form: FormData): { name: string; language: string; category: string; components: TemplateComponents } {
  const header = String(form.get("headerFormat") ?? "");
  const buttons: Button[] = [];
  for (let i = 0; i < 3; i++) {
    const type = String(form.get(`button${i}Type`) ?? "");
    const text = String(form.get(`button${i}Text`) ?? "").trim();
    if (!type || !text) continue;
    if (type === "URL") buttons.push({ type, text, url: String(form.get(`button${i}Value`) ?? "").trim() });
    else if (type === "PHONE_NUMBER") buttons.push({ type, text, phone_number: String(form.get(`button${i}Value`) ?? "").trim() });
    else buttons.push({ type: "QUICK_REPLY", text });
  }
  const bodyText = String(form.get("body") ?? "").trim();
  const count = countVariables(bodyText);
  const examples = Array.from({ length: count.ok ? count.count : 0 }, (_, i) => String(form.get(`example${i + 1}`) ?? "").trim());
  return {
    name: String(form.get("name") ?? "").trim().toLowerCase(),
    language: String(form.get("language") ?? "en").trim(),
    category: String(form.get("category") ?? "MARKETING"),
    components: {
      ...(header === "TEXT" ? { header: { format: "TEXT" as const, text: String(form.get("headerText") ?? "").trim() } } : {}),
      ...(["IMAGE", "VIDEO", "DOCUMENT"].includes(header) ? { header: { format: header as HeaderFormat } } : {}),
      body: { text: bodyText, examples },
      ...(String(form.get("footer") ?? "").trim() ? { footer: { text: String(form.get("footer")).trim() } } : {}),
      ...(buttons.length ? { buttons } : {}),
    },
  };
}

async function accountWithToken(businessId: string, accountId: string) {
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("whatsapp_accounts")
    .select("id, waba_id, phone_number_id, provider")
    .eq("id", accountId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!account) return null;
  const { data: token } = await createAdminClient().rpc("whatsapp_account_token", { p_account_id: account.id });
  return token ? { ...account, token: String(token) } : null;
}

/** Saves a draft and submits it to the provider for approval. */
export async function submitTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("templates.manage");
    const accountId = uuid.safeParse(form.get("accountId"));
    if (!accountId.success) return { ok: false, message: "Choose the WhatsApp number whose account will own the template." };
    const t = readTemplate(form);
    const errors = validateTemplate(t.name, t.components);
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(t.language)) errors.push("Language looks like en, hi or en_US.");
    if (!["MARKETING", "UTILITY"].includes(t.category)) errors.push("Choose marketing or utility.");
    if (errors.length) return { ok: false, message: errors.join(" "), values: echo(form) };

    const account = await accountWithToken(ctx.business.businessId, accountId.data);
    if (!account) return { ok: false, message: "That number isn't connected, or needs reconnecting." };

    // Media headers need a sample file uploaded to Meta first.
    if (t.components.header && t.components.header.format !== "TEXT") {
      if (account.provider !== "meta_cloud") {
        return { ok: false, message: "Media headers can be created here for numbers connected directly to Meta. For 360dialog, create them in the 360dialog hub and press Sync.", values: echo(form) };
      }
      const file = form.get("headerSample");
      if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Add a sample file for the media header.", values: echo(form) };
      if (file.size > 5 * 1024 * 1024) return { ok: false, message: "The sample must be under 5 MB.", values: echo(form) };
      const handle = await uploadTemplateSample(account.token, { bytes: await file.arrayBuffer(), type: file.type, name: file.name });
      if (!handle.ok) return { ok: false, message: `Meta didn't accept the sample: ${handle.error}`, values: echo(form) };
      t.components.header.handle = handle.value;
    }

    const supabase = await createClient();
    const count = countVariables(t.components.body.text);
    const { data: row, error } = await supabase
      .from("whatsapp_templates")
      .insert({
        business_id: ctx.business.businessId,
        waba_id: account.waba_id,
        name: t.name,
        language: t.language,
        category: t.category,
        components: t.components,
        variable_count: count.ok ? count.count : 0,
        status: "draft",
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (error) {
      const msg = error.message.includes("whatsapp_templates_business_id_waba_id_name_language_key")
        ? "A template with that name and language already exists."
        : friendlyDbError(error);
      return { ok: false, message: msg, values: echo(form) };
    }

    const created = await providerFor(account.provider).createTemplate(
      { phoneNumberId: account.phone_number_id, wabaId: account.waba_id, token: account.token },
      toProviderTemplate(t.name, t.language, t.category, t.components),
    );
    const admin = createAdminClient();
    if (!created.ok) {
      await admin.rpc("apply_template_status", { p_waba_id: account.waba_id, p_payload: { name: t.name, language: t.language, status: "REJECTED", reason: created.error } });
      refresh();
      return { ok: false, message: `Meta rejected the template: ${created.error}. Edit it and submit again.` };
    }
    await admin.rpc("apply_template_status", {
      p_waba_id: account.waba_id,
      p_payload: { id: created.value.id, name: t.name, language: t.language, status: created.value.status || "PENDING" },
    });
    refresh();
    redirect(`/campaigns/templates?submitted=${row.id}`);
  });
}

/** Pulls every template's current status from the provider. */
export async function syncTemplates(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("templates.manage");
    const account = await accountWithToken(ctx.business.businessId, uuid.parse(form.get("accountId")));
    if (!account) return { ok: false, message: "That number isn't connected." };
    const list = await providerFor(account.provider).listTemplates({ phoneNumberId: account.phone_number_id, wabaId: account.waba_id, token: account.token });
    if (!list.ok) return { ok: false, message: `Couldn't fetch templates: ${list.error}` };
    const admin = createAdminClient();
    let updated = 0;
    for (const t of list.value) {
      const { data } = await admin.rpc("apply_template_status", {
        p_waba_id: account.waba_id,
        p_payload: { id: t.id, name: t.name, language: t.language, status: t.status, reason: t.reason },
      });
      updated += Number(data ?? 0);
    }
    refresh();
    return { ok: true, message: `Synced. ${updated} template${updated === 1 ? "" : "s"} updated from ${list.value.length} on the account.` };
  });
}

export async function deleteTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("templates.manage");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("whatsapp_templates")
      .delete()
      .eq("id", uuid.parse(form.get("templateId")))
      .eq("business_id", ctx.business.businessId)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "Only drafts and rejected templates not used by a campaign can be removed." };
    refresh();
    return { ok: true, message: "Template removed." };
  });
}

// ------------------------------------------------------------------ campaigns

function readFilter(form: FormData): CampaignFilter {
  const num = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    return /^\d{1,5}$/.test(v) ? Number(v) : undefined;
  };
  const f: CampaignFilter = {};
  const branch = String(form.get("f_branch") ?? "");
  if (uuid.safeParse(branch).success) f.branch_id = branch;
  const owner = String(form.get("f_owner") ?? "");
  if (uuid.safeParse(owner).success) f.owner_id = owner;
  const tags = ids(form, "f_tags");
  if (tags.length) f.tag_ids = tags;
  const sources = ids(form, "f_sources");
  if (sources.length) f.lead_source_ids = sources;
  const statuses = ids(form, "f_statuses");
  if (statuses.length) f.lead_status_ids = statuses;
  const orders = String(form.get("f_has_orders") ?? "");
  if (orders === "yes" || orders === "no") f.has_orders = orders === "yes";
  const noOrder = num("f_no_order_days");
  if (noOrder) f.no_order_days = noOrder;
  const created = num("f_created_within_days");
  if (created) f.created_within_days = created;
  const month = num("f_birthday_month");
  if (month && month >= 1 && month <= 12) f.birthday_month = month;
  const ltv = String(form.get("f_min_ltv") ?? "").replace(/,/g, "").trim();
  if (/^\d{1,12}(\.\d{1,2})?$/.test(ltv)) f.min_lifetime_value = ltv;
  return f;
}

const campaignSchema = z.object({
  campaignId: z.union([z.uuid(), z.literal("")]).optional(),
  name: z.string().trim().min(1, "Name the campaign.").max(120),
  accountId: z.uuid("Choose the number to send from."),
  templateId: z.uuid("Choose an approved template."),
  headerMediaUrl: z.union([z.url({ protocol: /^https$/ }), z.literal("")]).optional(),
  ratePerMinute: z.coerce.number().int().min(1).max(1000).default(60),
});

export async function saveCampaign(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("campaigns.manage");
    const parsed = campaignSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message, values: echo(form) };
    const d = parsed.data;
    const supabase = await createClient();
    const { data: template } = await supabase
      .from("whatsapp_templates")
      .select("variable_count")
      .eq("id", d.templateId)
      .maybeSingle();
    const variables = Array.from({ length: template?.variable_count ?? 0 }, (_, i) => {
      const source = String(form.get(`var${i + 1}Source`) ?? "first_name");
      return source === "static" ? { source, value: String(form.get(`var${i + 1}Value`) ?? "").slice(0, 200) } : { source };
    });
    const row = {
      name: d.name,
      account_id: d.accountId,
      template_id: d.templateId,
      variables,
      header_media_url: d.headerMediaUrl || null,
      filter: readFilter(form),
      rate_per_minute: d.ratePerMinute,
    };
    if (d.campaignId) {
      const { data, error } = await supabase.from("campaigns").update(row).eq("id", d.campaignId).eq("business_id", ctx.business.businessId).select("id");
      if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
      if (!data?.length) return { ok: false, message: "Only draft campaigns can be edited." };
      refresh();
      return { ok: true, message: "Campaign saved." };
    }
    const { data, error } = await supabase
      .from("campaigns")
      .insert({ ...row, business_id: ctx.business.businessId, status: "draft", created_by: ctx.user.id })
      .select("id")
      .single();
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    redirect(`/campaigns/${data.id}`);
  });
}

/** Audience size as the filters change (no save needed). */
export async function estimateAudience(form: FormData) {
  const ctx = await requirePermission("campaigns.manage");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("audience_estimate", { p_business_id: ctx.business.businessId, p_filter: readFilter(form) });
  if (error) return null;
  return data as { matching: number; eligible: number; no_phone: number; no_consent: number; suppressed: number };
}

/** Sends the template to one staff number, without touching the recipient list. */
export async function testSend(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("campaigns.manage");
    const campaignId = uuid.parse(form.get("campaignId"));
    const phone = normalisePhone(String(form.get("phone") ?? ""), ctx.business.countryCode as CountryCode);
    if (!phone) return { ok: false, message: "Enter a valid phone number." };
    const supabase = await createClient();
    const { data: c } = await supabase
      .from("campaigns")
      .select("account_id, variables, header_media_url, template:whatsapp_templates(name, language, components, status)")
      .eq("id", campaignId)
      .maybeSingle();
    const template = c?.template as unknown as { name: string; language: string; components: TemplateComponents; status: string } | null;
    if (!c || !template || !c.account_id) return { ok: false, message: "Save the campaign with a number and template first." };
    if (template.status !== "approved") return { ok: false, message: "The template isn't approved yet." };
    const account = await accountWithToken(ctx.business.businessId, c.account_id);
    if (!account) return { ok: false, message: "That number isn't connected." };
    const params = ((c.variables ?? []) as { source: string; value?: string }[]).map((v) =>
      v.source === "static" ? (v.value ?? "") : v.source === "business_name" ? ctx.business.businessName : (ctx.user.fullName ?? "there").split(" ")[0],
    );
    const result = await providerFor(account.provider).sendTemplate(
      { phoneNumberId: account.phone_number_id, wabaId: account.waba_id, token: account.token },
      phone,
      { name: template.name, language: template.language, components: toSendComponents(template.components, params, c.header_media_url) },
    );
    await supabase.rpc("log_campaign_test", { p_campaign_id: campaignId, p_phone: phone, p_error: result.ok ? null : result.error });
    refresh();
    return result.ok
      ? { ok: true, message: `Test sent to ${phone}: “${renderBody(template.components.body.text, params)}”` }
      : { ok: false, message: `WhatsApp refused the test: ${result.error}` };
  });
}

export async function launchCampaign(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("campaigns.send");
    const campaignId = uuid.parse(form.get("campaignId"));
    const when = String(form.get("scheduleAt") ?? "").trim();
    const at = when ? parseLocalInput(when, ctx.business.timezone) : null;
    if (when && !at) return { ok: false, message: "Pick a valid date and time." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("launch_campaign", {
      p_campaign_id: campaignId,
      p_scheduled_at: at?.toISOString() ?? null,
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    const r = data as { status: string; recipients?: number };
    // Start sending now rather than waiting for the next job run.
    if (r.status === "sending") after(() => runCampaigns(1).catch((e) => console.error("[campaigns]", e)));
    refresh();
    return {
      ok: true,
      message:
        r.status === "scheduled"
          ? "Scheduled. Recipients are chosen when it starts, so later opt-outs are respected."
          : r.status === "completed"
            ? "Nobody in this audience can be messaged (no opt-in, no phone, or suppressed)."
            : `Sending to ${r.recipients} customers, throttled to the rate you set.`,
    };
  });
}

export async function changeCampaignState(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await requirePermission("campaigns.send");
    const action = z.enum(["pause", "resume", "cancel", "unschedule"]).parse(form.get("action"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_campaign_state", { p_campaign_id: uuid.parse(form.get("campaignId")), p_action: action });
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (action === "resume") after(() => runCampaigns(1).catch((e) => console.error("[campaigns]", e)));
    refresh();
    return { ok: true, message: { pause: "Paused.", resume: "Resumed.", cancel: "Cancelled. Nothing more will be sent.", unschedule: "Back to draft." }[action] };
  });
}

export async function duplicateCampaign(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await requirePermission("campaigns.manage");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("duplicate_campaign", { p_campaign_id: uuid.parse(form.get("campaignId")) });
    if (error) return { ok: false, message: friendlyDbError(error) };
    redirect(`/campaigns/${data}`);
  });
}

// ------------------------------------------------------------------ suppressions

export async function addSuppression(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("campaigns.manage");
    const phone = normalisePhone(String(form.get("phone") ?? ""), ctx.business.countryCode as CountryCode);
    if (!phone) return { ok: false, message: "Enter a valid phone number.", values: echo(form) };
    const supabase = await createClient();
    const { error } = await supabase.from("suppressions").insert({
      business_id: ctx.business.businessId,
      phone,
      reason: "manual",
      note: String(form.get("note") ?? "").trim().slice(0, 500) || null,
      created_by: ctx.user.id,
    });
    if (error) {
      return { ok: false, message: error.code === "23505" ? "That number is already suppressed." : friendlyDbError(error) };
    }
    refresh();
    return { ok: true, message: `${phone} won't receive campaigns.` };
  });
}

export async function removeSuppression(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("campaigns.manage");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("suppressions")
      .delete()
      .eq("id", uuid.parse(form.get("id")))
      .eq("business_id", ctx.business.businessId)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "Opt-outs can only be lifted by the customer replying START." };
    refresh();
    return { ok: true, message: "Removed from the suppression list." };
  });
}
