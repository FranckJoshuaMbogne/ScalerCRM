import { escapeHtml, layout, type RenderedEmail, str } from "@/modules/email/layout";

/** Sent to everyone who manages integrations when an endpoint is switched off (finish_webhook_delivery). */
export function webhookDisabledEmail(p: Record<string, unknown>, origin: string): RenderedEmail {
  const business = str(p.business_name) || "your business";
  const endpoint = str(p.url) || "a webhook endpoint";
  const lastError = str(p.last_error);
  const path = str(p.path).startsWith("/") ? str(p.path) : "/settings/webhooks";
  const url = `${origin}${path}`;
  const footer = `You get this because you manage integrations for ${business} on SCALER.`;
  const lines = [
    `SCALER switched off the webhook endpoint ${endpoint} after 20 failed deliveries in a row.`,
    ...(lastError ? [`Last error: ${lastError}`] : []),
    "No more events are sent to it. Fix the receiving server, turn the endpoint back on, then replay the deliveries you missed from the delivery log.",
  ];
  return {
    subject: `Webhook switched off for ${business}`,
    html: layout("A webhook endpoint was switched off", lines.map(escapeHtml), { label: "Open the delivery log", url }, escapeHtml(footer)),
    text: [...lines, "", `Open the delivery log: ${url}`, "", footer].join("\n"),
  };
}
