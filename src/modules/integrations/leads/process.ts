import "server-only";
import type { CountryCode } from "libphonenumber-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalisePhone } from "@/modules/crm/phone";
import { fetchFormName, fetchLead } from "@/modules/integrations/ads/clients";
import { applyMapping, fromGoogleLead, fromMetaLead, type Mapping } from "./mapping";

type Admin = ReturnType<typeof createAdminClient>;
type Context = {
  provider: string;
  business_id: string;
  payload: Record<string, unknown>;
  country_code: string;
  page_token: string | null;
  form: { mapping: Mapping; source_id: string | null } | null;
};

/**
 * Processes one stored Lead Ads / Google lead: fetch (Meta) → map fields →
 * normalisePhone → ingest_external_lead (matching, round-robin, history).
 * Failures stay pending and are retried by the job route, up to five times.
 */
export async function processLeadEvent(admin: Admin, id: number) {
  try {
    const { data, error } = await admin.rpc("lead_event_context", { p_event_id: id });
    if (error || !data) throw new Error(error?.message ?? "event not found");
    const ctx = data as Context;
    const mapping = ctx.form?.mapping ?? {};

    let answers;
    let touch: Record<string, string>;
    let campaign: string | null = null;
    let source = "other";
    let form: { id: string | null; name: string | null };

    if (ctx.provider === "google_ads") {
      const g = fromGoogleLead(ctx.payload);
      answers = g.answers;
      touch = g.touch;
      source = "google_ads";
      form = { id: g.formId, name: null };
      Object.assign(mapping, { ...g.builtInMapping, ...mapping });
    } else {
      if (!ctx.page_token) throw new Error("the Facebook page is disconnected");
      const lead = await fetchLead(String(ctx.payload.leadgen_id), ctx.page_token);
      if (!lead.ok) throw new Error(`Meta: ${lead.error}`);
      const m = fromMetaLead(lead.value);
      answers = m.answers;
      touch = m.touch;
      campaign = m.campaign;
      source = m.platform === "ig" ? "instagram" : "meta_ads";
      const formId = String(lead.value.form_id ?? ctx.payload.form_id ?? "") || null;
      const name = formId && !ctx.form ? await fetchFormName(formId, ctx.page_token) : null;
      form = { id: formId, name: name && name.ok ? (name.value.name ?? null) : null };
    }

    const mapped = applyMapping(answers, mapping);
    const phone = mapped.phone ? normalisePhone(mapped.phone, ctx.country_code as CountryCode) : null;
    if (!phone && !mapped.email) throw new Error("the lead has no usable phone number or email");

    const { error: ingestError } = await admin.rpc("ingest_external_lead", {
      p_event_id: id,
      p_input: {
        phone,
        email: mapped.email,
        full_name: mapped.fullName ?? phone ?? mapped.email,
        description: mapped.notes.join("\n") || null,
        custom_fields: mapped.customFields,
        source,
        campaign,
        touch,
        form: { id: form.id, name: form.name, fields: answers.map((a) => a.field) },
      },
    });
    if (ingestError) throw new Error(ingestError.message);
  } catch (e) {
    const message = e instanceof Error ? e.message : "processing failed";
    console.error(`[leads] event ${id}:`, message);
    await admin.rpc("finish_webhook_event", { p_event_id: id, p_error: message });
  }
}
