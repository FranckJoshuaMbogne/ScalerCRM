import "server-only";
import { metaConfig } from "./config";
import type { MessagingProvider, PhoneNumberInfo, ProviderResult } from "./provider";

const base = () => `https://graph.facebook.com/${metaConfig().graphVersion}`;

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number; error_data?: unknown } };

async function graph<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<ProviderResult<T>> {
  const { token, ...rest } = init;
  try {
    const res = await fetch(path.startsWith("http") ? path : `${base()}${path}`, {
      ...rest,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(rest.body ? { "content-type": "application/json" } : {}),
        ...rest.headers,
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as T & GraphError;
    if (!res.ok || json.error) {
      return {
        ok: false,
        error: json.error?.message ?? `${res.status} ${res.statusText}`,
        code: json.error?.code,
        details: json.error,
      };
    }
    return { ok: true, value: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

/** Meta's API takes the recipient as digits with country code, no "+". */
export const waId = (e164: string) => e164.replace(/^\+/, "");

export const metaCloud: MessagingProvider = {
  async sendText(phoneNumberId, token, to, body) {
    const r = await graph<{ messages?: { id: string }[] }>(`/${phoneNumberId}/messages`, {
      method: "POST",
      token,
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: waId(to), type: "text", text: { body, preview_url: true } }),
    });
    if (!r.ok) return r;
    const wamid = r.value.messages?.[0]?.id;
    return wamid ? { ok: true, value: { wamid } } : { ok: false, error: "no message id returned" };
  },

  async getPhoneNumber(phoneNumberId, token) {
    const r = await graph<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
      `/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      { token },
    );
    if (!r.ok) return r;
    const info: PhoneNumberInfo = {
      displayPhone: r.value.display_phone_number ?? null,
      verifiedName: r.value.verified_name ?? null,
      qualityRating: r.value.quality_rating ?? null,
    };
    return { ok: true, value: info };
  },

  async getMediaUrl(mediaId, token) {
    const r = await graph<{ url?: string; mime_type?: string }>(`/${mediaId}`, { token });
    if (!r.ok) return r;
    return r.value.url ? { ok: true, value: { url: r.value.url, mimeType: r.value.mime_type ?? null } } : { ok: false, error: "no media url" };
  },

  downloadMedia(url, token) {
    return fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
  },
};

// ------------------------------------------------------------ Embedded Signup (onboarding only)

export async function exchangeCode(code: string): Promise<ProviderResult<{ access_token: string }>> {
  const c = metaConfig();
  const q = new URLSearchParams({ client_id: c.appId, client_secret: c.appSecret, code });
  return graph<{ access_token: string }>(`/oauth/access_token?${q}`);
}

/** Subscribes SCALER's app to the WABA so its webhooks reach us. */
export function subscribeApp(wabaId: string, token: string) {
  return graph<{ success?: boolean }>(`/${wabaId}/subscribed_apps`, { method: "POST", token });
}

/** Registers the number for Cloud API messaging with a two-step verification PIN. */
export function registerNumber(phoneNumberId: string, token: string, pin: string) {
  return graph<{ success?: boolean }>(`/${phoneNumberId}/register`, {
    method: "POST",
    token,
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
}
