/** Outbound webhook events. The database list is private.webhook_event_types(). */
export const WEBHOOK_EVENTS = [
  { type: "lead.created", label: "Lead created", description: "A new lead arrived (form, ad, WhatsApp, walk-in or the API)." },
  { type: "lead.stage_changed", label: "Lead moved", description: "A lead moved to another pipeline stage." },
  { type: "order.created", label: "Order created", description: "An order was created, with its lines and totals." },
  { type: "order.stage_changed", label: "Order moved", description: "An order moved to another stage, e.g. ready or delivered." },
  { type: "payment.recorded", label: "Payment recorded", description: "A payment or refund was recorded against an order." },
  { type: "customer.merged", label: "Customers merged", description: "Two customer files were merged into one." },
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]["type"];

export const WEBHOOK_EVENT_TYPES = WEBHOOK_EVENTS.map((e) => e.type) as [WebhookEventType, ...WebhookEventType[]];

export function isWebhookEventType(v: string): v is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(v);
}
