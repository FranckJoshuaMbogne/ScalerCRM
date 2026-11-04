/**
 * Meta WhatsApp Cloud API webhooks: signature check and parsing into flat,
 * storable items. Pure (Node crypto only), so it is unit tested.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** X-Hub-Signature-256 is "sha256=<hex HMAC of the raw body with the app secret>". */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"), "utf8");
  const given = Buffer.from(header.slice(7), "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type Media = { id: string; mime_type?: string; sha256?: string; filename?: string; caption?: string };

export type InboundMessage = {
  phoneNumberId: string;
  wamid: string;
  from: string; // wa_id: digits with country code, no "+"
  profileName: string | null;
  type: string;
  body: string | null;
  media: Media | null;
  sentAt: string; // ISO
};

export type StatusUpdate = {
  phoneNumberId: string;
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  at: string;
  errors: unknown[] | null;
};

export type WebhookItem =
  | { kind: "message"; externalId: string; phoneNumberId: string; item: InboundMessage }
  | { kind: "status"; externalId: string; phoneNumberId: string; item: StatusUpdate };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"] as const;

function iso(ts: unknown): string {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

/** Text shown for a message in the inbox, whatever its type. */
export function messageText(m: Json): { body: string | null; media: Media | null } {
  const type = str(m.type) ?? "unknown";
  if (type === "text") return { body: str(obj(m.text).body), media: null };
  if ((MEDIA_TYPES as readonly string[]).includes(type)) {
    const media = obj(m[type]);
    const id = str(media.id);
    return {
      body: str(media.caption),
      media: id
        ? {
            id,
            mime_type: str(media.mime_type) ?? undefined,
            sha256: str(media.sha256) ?? undefined,
            filename: str(media.filename) ?? undefined,
            caption: str(media.caption) ?? undefined,
          }
        : null,
    };
  }
  if (type === "location") {
    const l = obj(m.location);
    const place = [str(l.name), str(l.address)].filter(Boolean).join(", ");
    return { body: `📍 ${place || `${l.latitude}, ${l.longitude}`}`, media: null };
  }
  if (type === "button") return { body: str(obj(m.button).text), media: null };
  if (type === "interactive") {
    const i = obj(m.interactive);
    return { body: str(obj(i.button_reply).title) ?? str(obj(i.list_reply).title), media: null };
  }
  if (type === "reaction") return { body: `Reacted ${str(obj(m.reaction).emoji) ?? ""}`.trim(), media: null };
  if (type === "contacts") {
    const names = arr(m.contacts).map((c) => str(obj(obj(c).name).formatted_name)).filter(Boolean);
    return { body: names.length ? `Shared contact: ${names.join(", ")}` : "Shared a contact", media: null };
  }
  return { body: null, media: null };
}

/** Flattens a webhook body into one item per message and per status. Unknown shapes are skipped. */
export function parseWebhook(payload: unknown): WebhookItem[] {
  const out: WebhookItem[] = [];
  const body = obj(payload);
  if (body.object !== "whatsapp_business_account") return out;
  for (const entry of arr(body.entry)) {
    for (const change of arr(obj(entry).changes)) {
      const c = obj(change);
      if (c.field !== "messages") continue;
      const value = obj(c.value);
      const phoneNumberId = str(obj(value.metadata).phone_number_id);
      if (!phoneNumberId) continue;
      const names = new Map(
        arr(value.contacts).map((ct) => [str(obj(ct).wa_id) ?? "", str(obj(obj(ct).profile).name)] as const),
      );
      for (const raw of arr(value.messages)) {
        const m = obj(raw);
        const wamid = str(m.id);
        const from = str(m.from);
        if (!wamid || !from) continue;
        const { body: text, media } = messageText(m);
        out.push({
          kind: "message",
          externalId: wamid,
          phoneNumberId,
          item: {
            phoneNumberId,
            wamid,
            from,
            profileName: names.get(from) ?? null,
            type: str(m.type) ?? "unknown",
            body: text,
            media,
            sentAt: iso(m.timestamp),
          },
        });
      }
      for (const raw of arr(value.statuses)) {
        const s = obj(raw);
        const wamid = str(s.id);
        const status = str(s.status);
        if (!wamid || !status || !["sent", "delivered", "read", "failed"].includes(status)) continue;
        out.push({
          kind: "status",
          externalId: `${wamid}:${status}`,
          phoneNumberId,
          item: {
            phoneNumberId,
            wamid,
            status: status as StatusUpdate["status"],
            at: iso(s.timestamp),
            errors: Array.isArray(s.errors) ? s.errors : null,
          },
        });
      }
    }
  }
  return out;
}

/** WhatsApp's 24-hour customer service window. */
export const SERVICE_WINDOW_MS = 24 * 3600_000;

export function windowState(lastInboundAt: string | null, now: Date) {
  if (!lastInboundAt) return { open: false, closesAt: null as Date | null };
  const closesAt = new Date(new Date(lastInboundAt).getTime() + SERVICE_WINDOW_MS);
  return { open: closesAt.getTime() > now.getTime(), closesAt };
}
