import "server-only";
import { metaConfig } from "./config";
import type { Account, MessagingProvider, PhoneNumberInfo, ProviderResult, ProviderTemplate } from "./provider";

type GraphError = { error?: { message?: string; code?: number; error_user_msg?: string } };

/** Shared JSON fetch for Graph-style APIs (Meta and 360dialog). */
export async function callJson<T>(url: string, init: RequestInit = {}): Promise<ProviderResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as T & GraphError;
    if (!res.ok || json.error) {
      return {
        ok: false,
        error: json.error?.error_user_msg ?? json.error?.message ?? `${res.status} ${res.statusText}`,
        code: json.error?.code,
        status: res.status,
        details: json.error,
      };
    }
    return { ok: true, value: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

const base = () => `https://graph.facebook.com/${metaConfig().graphVersion}`;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Meta's API takes the recipient as digits with country code, no "+". */
export const waId = (e164: string) => e164.replace(/^\+/, "");

function wamidOf(r: ProviderResult<{ messages?: { id: string }[] }>): ProviderResult<{ wamid: string }> {
  if (!r.ok) return r;
  const wamid = r.value.messages?.[0]?.id;
  return wamid ? { ok: true, value: { wamid } } : { ok: false, error: "no message id returned", status: 200 };
}

export const metaCloud: MessagingProvider = {
  name: "meta_cloud",

  async sendText(a: Account, to, body) {
    return wamidOf(
      await callJson(`${base()}/${a.phoneNumberId}/messages`, {
        method: "POST",
        headers: auth(a.token),
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: waId(to), type: "text", text: { body, preview_url: true } }),
      }),
    );
  },

  async sendTemplate(a, to, t) {
    return wamidOf(
      await callJson(`${base()}/${a.phoneNumberId}/messages`, {
        method: "POST",
        headers: auth(a.token),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: waId(to),
          type: "template",
          template: { name: t.name, language: { code: t.language }, components: t.components },
        }),
      }),
    );
  },

  async getPhoneNumber(a) {
    const r = await callJson<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
      `${base()}/${a.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: auth(a.token) },
    );
    if (!r.ok) return r;
    const info: PhoneNumberInfo = {
      displayPhone: r.value.display_phone_number ?? null,
      verifiedName: r.value.verified_name ?? null,
      qualityRating: r.value.quality_rating ?? null,
    };
    return { ok: true, value: info };
  },

  async getMediaUrl(a, mediaId) {
    const r = await callJson<{ url?: string; mime_type?: string }>(`${base()}/${mediaId}`, { headers: auth(a.token) });
    if (!r.ok) return r;
    return r.value.url ? { ok: true, value: { url: r.value.url, mimeType: r.value.mime_type ?? null } } : { ok: false, error: "no media url" };
  },

  downloadMedia(a, url) {
    return fetch(url, { headers: auth(a.token), signal: AbortSignal.timeout(30_000), cache: "no-store" });
  },

  async createTemplate(a, payload) {
    const r = await callJson<{ id?: string; status?: string }>(`${base()}/${a.wabaId}/message_templates`, {
      method: "POST",
      headers: auth(a.token),
      body: JSON.stringify(payload),
    });
    return r.ok ? { ok: true, value: { id: r.value.id ?? null, status: r.value.status ?? "PENDING" } } : r;
  },

  async listTemplates(a) {
    const out: ProviderTemplate[] = [];
    let url: string | null = `${base()}/${a.wabaId}/message_templates?fields=id,name,language,status,rejected_reason&limit=100`;
    for (let page = 0; url && page < 10; page++) {
      const r: ProviderResult<{ data?: Record<string, string>[]; paging?: { next?: string } }> = await callJson(url, { headers: auth(a.token) });
      if (!r.ok) return r;
      for (const t of r.value.data ?? []) {
        out.push({ id: t.id ?? null, name: t.name, language: t.language, status: t.status, reason: t.rejected_reason ?? null });
      }
      url = r.value.paging?.next ?? null;
    }
    return { ok: true, value: out };
  },
};

/**
 * Uploads a sample file for a media-header template (Resumable Upload API)
 * and returns the handle Meta expects in the template example.
 */
export async function uploadTemplateSample(token: string, file: { bytes: ArrayBuffer; type: string; name: string }): Promise<ProviderResult<string>> {
  const { appId } = metaConfig();
  if (!appId) return { ok: false, error: "META_APP_ID is not set" };
  const q = new URLSearchParams({ file_name: file.name, file_length: String(file.bytes.byteLength), file_type: file.type });
  const session = await callJson<{ id?: string }>(`${base()}/${appId}/uploads?${q}`, { method: "POST", headers: auth(token) });
  if (!session.ok || !session.value.id) return session.ok ? { ok: false, error: "no upload session" } : session;
  try {
    const res = await fetch(`${base()}/${session.value.id}`, {
      method: "POST",
      headers: { authorization: `OAuth ${token}`, file_offset: "0" },
      body: file.bytes,
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json().catch(() => ({}))) as { h?: string; error?: { message?: string } };
    return json.h ? { ok: true, value: json.h } : { ok: false, error: json.error?.message ?? `upload failed (${res.status})` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "upload failed" };
  }
}

// ------------------------------------------------------------ Embedded Signup (onboarding only)

export async function exchangeCode(code: string): Promise<ProviderResult<{ access_token: string }>> {
  const c = metaConfig();
  const q = new URLSearchParams({ client_id: c.appId, client_secret: c.appSecret, code });
  return callJson<{ access_token: string }>(`${base()}/oauth/access_token?${q}`);
}

/** Subscribes SCALER's app to the WABA so its webhooks reach us. */
export function subscribeApp(wabaId: string, token: string) {
  return callJson<{ success?: boolean }>(`${base()}/${wabaId}/subscribed_apps`, { method: "POST", headers: auth(token) });
}

/** Registers the number for Cloud API messaging with a two-step verification PIN. */
export function registerNumber(phoneNumberId: string, token: string, pin: string) {
  return callJson<{ success?: boolean }>(`${base()}/${phoneNumberId}/register`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
}
