/**
 * Turning Meta Lead Ads and Google Ads lead-form submissions into SCALER lead
 * input. Pure: phone normalisation is done by the caller with normalisePhone().
 */

export type Target = "full_name" | "first_name" | "last_name" | "phone" | "email" | "note" | "ignore" | `custom:${string}`;
export type Mapping = Record<string, Target>;
export type Answer = { field: string; value: string };

/** Sensible defaults for standard Meta / Google field names. */
export function defaultTarget(field: string): Target {
  const f = field.toLowerCase();
  if (f === "full_name" || f === "name") return "full_name";
  if (f === "first_name") return "first_name";
  if (f === "last_name") return "last_name";
  if (f.includes("phone") || f === "mobile" || f === "whatsapp_number") return "phone";
  if (f.includes("email")) return "email";
  return "note";
}

export type MappedLead = {
  fullName: string | null;
  phone: string | null;
  email: string | null;
  notes: string[];
  customFields: Record<string, string>;
};

export function applyMapping(answers: Answer[], mapping: Mapping): MappedLead {
  let full: string | null = null;
  let first = "";
  let last = "";
  let phone: string | null = null;
  let email: string | null = null;
  const notes: string[] = [];
  const customFields: Record<string, string> = {};
  for (const { field, value } of answers) {
    const v = value.trim();
    if (!v) continue;
    const target = mapping[field] ?? defaultTarget(field);
    if (target === "full_name") full = v;
    else if (target === "first_name") first = v;
    else if (target === "last_name") last = v;
    else if (target === "phone") phone ??= v;
    else if (target === "email") email ??= v.toLowerCase();
    else if (target === "note") notes.push(`${field.replace(/_/g, " ")}: ${v}`);
    else if (target.startsWith("custom:")) customFields[target.slice(7)] = v;
  }
  const joined = [first, last].filter(Boolean).join(" ");
  return { fullName: full ?? (joined || null), phone, email, notes, customFields };
}

// ------------------------------------------------------------ Meta Lead Ads

export type LeadgenItem = { leadgenId: string; pageId: string; formId: string | null; adId: string | null; createdTime: number | null };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));

/** Page webhooks: object "page", field "leadgen". */
export function parseLeadgenWebhook(payload: unknown): LeadgenItem[] {
  const body = obj(payload);
  if (body.object !== "page") return [];
  const out: LeadgenItem[] = [];
  for (const entry of arr(body.entry)) {
    for (const change of arr(obj(entry).changes)) {
      const c = obj(change);
      if (c.field !== "leadgen") continue;
      const v = obj(c.value);
      const leadgenId = s(v.leadgen_id);
      const pageId = s(v.page_id) ?? s(obj(entry).id);
      if (!leadgenId || !pageId) continue;
      out.push({ leadgenId, pageId, formId: s(v.form_id), adId: s(v.ad_id), createdTime: v.created_time ? Number(v.created_time) : null });
    }
  }
  return out;
}

/** A lead fetched from GET /{leadgen_id}: answers plus ad ids. */
export function fromMetaLead(lead: unknown) {
  const l = obj(lead);
  const answers: Answer[] = arr(l.field_data).map((f) => ({
    field: String(obj(f).name ?? ""),
    value: arr(obj(f).values).map(String).join(", "),
  }));
  return {
    answers,
    platform: s(l.platform), // "fb" | "ig"
    campaign: s(l.campaign_name),
    touch: Object.fromEntries(
      Object.entries({
        campaign_id: s(l.campaign_id),
        adset_id: s(l.adset_id),
        ad_id: s(l.ad_id),
        form_id: s(l.form_id),
        utm_source: l.platform === "ig" ? "instagram" : "facebook",
        utm_medium: "paid_social",
      }).filter(([, v]) => v),
    ) as Record<string, string>,
  };
}

// ------------------------------------------------------------ Google Ads lead forms

const GOOGLE_COLUMNS: Record<string, Target> = {
  FULL_NAME: "full_name",
  FIRST_NAME: "first_name",
  LAST_NAME: "last_name",
  PHONE_NUMBER: "phone",
  EMAIL: "email",
};

/**
 * Google posts { lead_id, form_id, campaign_id, gcl_id, adgroup_id, creative_id,
 * google_key, is_test, user_column_data: [{column_id, column_name?, string_value}] }.
 */
export function fromGoogleLead(payload: unknown) {
  const p = obj(payload);
  const answers: Answer[] = arr(p.user_column_data).map((c) => {
    const col = obj(c);
    const id = String(col.column_id ?? "");
    return { field: GOOGLE_COLUMNS[id] ? id : String(col.column_name ?? id), value: String(col.string_value ?? "") };
  });
  const mapping: Mapping = Object.fromEntries(Object.entries(GOOGLE_COLUMNS));
  return {
    leadId: s(p.lead_id),
    formId: s(p.form_id),
    googleKey: s(p.google_key),
    isTest: p.is_test === true,
    answers,
    builtInMapping: mapping,
    touch: Object.fromEntries(
      Object.entries({
        campaign_id: s(p.campaign_id),
        adset_id: s(p.adgroup_id),
        ad_id: s(p.creative_id),
        form_id: s(p.form_id),
        gclid: s(p.gcl_id),
        utm_source: "google",
        utm_medium: "cpc",
      }).filter(([, v]) => v),
    ) as Record<string, string>,
  };
}
