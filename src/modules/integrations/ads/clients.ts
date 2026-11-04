import "server-only";
import { metaConfig } from "@/modules/integrations/whatsapp/config";
import { callJson } from "@/modules/integrations/whatsapp/meta-cloud";
import type { ProviderResult } from "@/modules/integrations/whatsapp/provider";
import { fromGoogleAds, fromMetaInsights, type SpendRow } from "./normalise";

const graph = () => `https://graph.facebook.com/${metaConfig().graphVersion}`;
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

// ------------------------------------------------------------ Meta: pages and leads

export function getPage(pageId: string, token: string) {
  return callJson<{ id: string; name?: string }>(`${graph()}/${pageId}?fields=id,name`, { headers: bearer(token) });
}

/** Subscribes SCALER's app to the page's leadgen webhooks. */
export function subscribePage(pageId: string, token: string) {
  return callJson<{ success?: boolean }>(`${graph()}/${pageId}/subscribed_apps?subscribed_fields=leadgen`, {
    method: "POST",
    headers: bearer(token),
  });
}

/** Pages the logged-in user manages, with their page tokens (server-side only). */
export function listUserPages(userToken: string) {
  return callJson<{ data?: { id: string; name: string; access_token: string }[] }>(
    `${graph()}/me/accounts?fields=id,name,access_token&limit=100`,
    { headers: bearer(userToken) },
  );
}

export function fetchLead(leadgenId: string, pageToken: string) {
  return callJson<Record<string, unknown>>(
    `${graph()}/${leadgenId}?fields=field_data,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic`,
    { headers: bearer(pageToken) },
  );
}

export function fetchFormName(formId: string, pageToken: string) {
  return callJson<{ name?: string }>(`${graph()}/${formId}?fields=name`, { headers: bearer(pageToken) });
}

/** When a token expires (needs the app id and secret). Null for non-expiring tokens. */
export async function tokenExpiry(token: string): Promise<string | null> {
  const { appId, appSecret } = metaConfig();
  if (!appId || !appSecret) return null;
  const q = new URLSearchParams({ input_token: token, access_token: `${appId}|${appSecret}` });
  const r = await callJson<{ data?: { expires_at?: number; data_access_expires_at?: number } }>(`${graph()}/debug_token?${q}`);
  const at = r.ok ? r.value.data?.expires_at : 0;
  return at ? new Date(at * 1000).toISOString() : null;
}

// ------------------------------------------------------------ Meta: spend

export async function metaSpend(accountId: string, token: string, since: string, until: string): Promise<ProviderResult<SpendRow[]>> {
  const q = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    fields: "campaign_id,campaign_name,spend,impressions,clicks,actions,date_start",
    time_range: JSON.stringify({ since, until }),
    limit: "500",
  });
  const rows: unknown[] = [];
  let url: string | null = `${graph()}/act_${accountId}/insights?${q}`;
  for (let page = 0; url && page < 20; page++) {
    const r: ProviderResult<{ data?: unknown[]; paging?: { next?: string } }> = await callJson(url, { headers: bearer(token) });
    if (!r.ok) return r;
    rows.push(...(r.value.data ?? []));
    url = r.value.paging?.next ?? null;
  }
  return { ok: true, value: fromMetaInsights(rows) };
}

// ------------------------------------------------------------ Google Ads

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

async function googleAccessToken(refreshToken: string): Promise<ProviderResult<string>> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body, signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
    return json.access_token ? { ok: true, value: json.access_token } : { ok: false, error: json.error_description ?? json.error ?? `${res.status}`, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "token request failed" };
  }
}

const GOOGLE_ADS_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v19";

export async function googleSpend(customerId: string, refreshToken: string, loginCustomerId: string | null, since: string, until: string): Promise<ProviderResult<SpendRow[]>> {
  if (!googleConfigured()) return { ok: false, error: "Google Ads API credentials are not configured on this server" };
  const access = await googleAccessToken(refreshToken);
  if (!access.ok) return access;
  const query = `SELECT campaign.id, campaign.name, campaign.status, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  const results: unknown[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r: ProviderResult<{ results?: unknown[]; nextPageToken?: string }> = await callJson(
      `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        headers: {
          ...bearer(access.value),
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
          ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
        },
        body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
      },
    );
    if (!r.ok) return r;
    results.push(...(r.value.results ?? []));
    pageToken = r.value.nextPageToken;
    if (!pageToken) break;
  }
  return { ok: true, value: fromGoogleAds(results) };
}
