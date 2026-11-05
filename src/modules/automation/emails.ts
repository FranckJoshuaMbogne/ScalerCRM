import { escapeHtml, type RenderedEmail, str } from "@/modules/email/layout";

/**
 * An email written by a business in a workflow ("Send an email" step). The
 * database has already filled in the names. Plain and personal: no SCALER
 * button, the business's name as the sign-off.
 */
export function automationEmail(p: Record<string, unknown>): RenderedEmail | null {
  const subject = str(p.subject);
  const body = typeof p.body === "string" ? p.body.trim() : "";
  if (!subject || !body) return null;
  const business = str(p.business_name);
  const footer = business ? `Sent by ${business}.` : "";
  const paragraphs = body.split(/\n{2,}/).map((para) => `<p style="margin:0 0 12px">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`);
  return {
    subject,
    html: `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1b1f;font-size:14px;line-height:1.5">
<div style="max-width:560px;margin:0 auto">${paragraphs.join("")}${footer ? `<p style="margin:24px 0 0;font-size:12px;color:#6b6b73">${escapeHtml(footer)}</p>` : ""}</div></body></html>`,
    text: [body, "", footer].join("\n").trim(),
  };
}
