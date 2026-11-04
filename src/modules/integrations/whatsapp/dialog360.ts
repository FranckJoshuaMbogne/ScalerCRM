import "server-only";
import { callJson, waId } from "./meta-cloud";
import type { MessagingProvider, ProviderResult, ProviderTemplate } from "./provider";

/**
 * 360dialog (BSP). Its v2 API mirrors the Cloud API message format, so sends,
 * webhooks and template payloads are shared with the Meta adapter; only the
 * host and the D360-API-KEY header differ.
 */
const BASE = "https://waba-v2.360dialog.io";
const auth = (token: string) => ({ "D360-API-KEY": token });

function wamidOf(r: ProviderResult<{ messages?: { id: string }[] }>): ProviderResult<{ wamid: string }> {
  if (!r.ok) return r;
  const wamid = r.value.messages?.[0]?.id;
  return wamid ? { ok: true, value: { wamid } } : { ok: false, error: "no message id returned", status: 200 };
}

export const dialog360: MessagingProvider = {
  name: "dialog360",

  async sendText(a, to, body) {
    return wamidOf(
      await callJson(`${BASE}/messages`, {
        method: "POST",
        headers: auth(a.token),
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: waId(to), type: "text", text: { body } }),
      }),
    );
  },

  async sendTemplate(a, to, t) {
    return wamidOf(
      await callJson(`${BASE}/messages`, {
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
    // The health endpoint confirms the key works; number details live in the 360dialog hub.
    const r = await callJson<{ health_status?: { can_send_message?: string } }>(`${BASE}/health_status`, { headers: auth(a.token) });
    if (!r.ok) return r;
    return { ok: true, value: { displayPhone: null, verifiedName: null, qualityRating: r.value.health_status?.can_send_message ?? null } };
  },

  async getMediaUrl(a, mediaId) {
    const r = await callJson<{ url?: string; mime_type?: string }>(`${BASE}/${mediaId}`, { headers: auth(a.token) });
    if (!r.ok) return r;
    if (!r.value.url) return { ok: false, error: "no media url" };
    // Media is fetched through 360dialog's host, not Meta's.
    const u = new URL(r.value.url);
    return { ok: true, value: { url: `${BASE}${u.pathname}${u.search}`, mimeType: r.value.mime_type ?? null } };
  },

  downloadMedia(a, url) {
    return fetch(url, { headers: auth(a.token), signal: AbortSignal.timeout(30_000), cache: "no-store" });
  },

  async createTemplate(a, payload) {
    const r = await callJson<{ id?: string; status?: string }>(`${BASE}/v1/configs/templates`, {
      method: "POST",
      headers: auth(a.token),
      body: JSON.stringify(payload),
    });
    return r.ok ? { ok: true, value: { id: r.value.id ?? null, status: r.value.status ?? "submitted" } } : r;
  },

  async listTemplates(a) {
    const r = await callJson<{ waba_templates?: Record<string, string>[] }>(`${BASE}/v1/configs/templates?limit=1000`, {
      headers: auth(a.token),
    });
    if (!r.ok) return r;
    const out: ProviderTemplate[] = (r.value.waba_templates ?? []).map((t) => ({
      id: t.id ?? null,
      name: t.name,
      language: t.language,
      status: t.status,
      reason: t.rejected_reason ?? null,
    }));
    return { ok: true, value: out };
  },
};
