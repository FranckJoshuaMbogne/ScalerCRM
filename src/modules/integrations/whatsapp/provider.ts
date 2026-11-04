/**
 * What SCALER needs from a WhatsApp provider. The Meta Cloud API adapter is the
 * first implementation; a BSP adapter (Sprint 6) implements the same interface.
 */
export type ProviderResult<T> = { ok: true; value: T } | { ok: false; error: string; code?: number; details?: unknown };

export type PhoneNumberInfo = { displayPhone: string | null; verifiedName: string | null; qualityRating: string | null };

export interface MessagingProvider {
  sendText(phoneNumberId: string, token: string, to: string, body: string): Promise<ProviderResult<{ wamid: string }>>;
  getPhoneNumber(phoneNumberId: string, token: string): Promise<ProviderResult<PhoneNumberInfo>>;
  /** Short-lived download URL for an inbound media id. */
  getMediaUrl(mediaId: string, token: string): Promise<ProviderResult<{ url: string; mimeType: string | null }>>;
  downloadMedia(url: string, token: string): Promise<Response>;
}
