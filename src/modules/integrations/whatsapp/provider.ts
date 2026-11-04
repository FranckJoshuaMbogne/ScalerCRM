/**
 * What SCALER needs from a WhatsApp provider. Meta Cloud API (direct) and
 * 360dialog (BSP) implement it; nothing outside src/modules/integrations
 * talks to a provider directly.
 */
export type ProviderResult<T> = { ok: true; value: T } | { ok: false; error: string; code?: number; status?: number; details?: unknown };

export type PhoneNumberInfo = { displayPhone: string | null; verifiedName: string | null; qualityRating: string | null };

export type ProviderTemplate = { id: string | null; name: string; language: string; status: string; reason: string | null };

export type Account = { phoneNumberId: string | null; wabaId: string; token: string };

export interface MessagingProvider {
  readonly name: "meta_cloud" | "dialog360";
  sendText(account: Account, to: string, body: string): Promise<ProviderResult<{ wamid: string }>>;
  sendTemplate(
    account: Account,
    to: string,
    template: { name: string; language: string; components: Record<string, unknown>[] },
  ): Promise<ProviderResult<{ wamid: string }>>;
  getPhoneNumber(account: Account): Promise<ProviderResult<PhoneNumberInfo>>;
  getMediaUrl(account: Account, mediaId: string): Promise<ProviderResult<{ url: string; mimeType: string | null }>>;
  downloadMedia(account: Account, url: string): Promise<Response>;
  createTemplate(account: Account, payload: Record<string, unknown>): Promise<ProviderResult<{ id: string | null; status: string }>>;
  listTemplates(account: Account): Promise<ProviderResult<ProviderTemplate[]>>;
}

/** Errors worth retrying: rate limits, throttling, server errors, network failures. */
export function isTemporary(r: { code?: number; status?: number }) {
  return (
    r.status === undefined ||
    r.status === 429 ||
    r.status >= 500 ||
    [4, 80007, 130429, 131016, 131048, 131056].includes(r.code ?? -1)
  );
}
