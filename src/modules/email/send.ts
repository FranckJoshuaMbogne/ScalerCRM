import "server-only";
import type { RenderedEmail } from "./templates";

/** Email is optional: without RESEND_API_KEY and EMAIL_FROM nothing is sent and invitations fall back to links. */
export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

/** Sends one email through Resend's HTTP API. Never throws. */
export type Attachment = { filename: string; content: string };

export async function sendEmail(to: string, email: RenderedEmail, attachments: Attachment[] = []): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: "email is not configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        // Resend takes attachment content base64-encoded.
        ...(attachments.length
          ? { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, "utf8").toString("base64") })) }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: `${res.status} ${body.message ?? res.statusText}` };
    return { ok: true, id: body.id ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}
