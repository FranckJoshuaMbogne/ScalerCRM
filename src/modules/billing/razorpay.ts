import { createHmac, timingSafeEqual } from "node:crypto";
import { paiseToRupees, rupeesToPaise } from "./money";
import type { BillingEvent, BillingEventKind, BillingProvider, ParsedWebhook } from "./types";

/**
 * Razorpay Subscriptions (UPI autopay, cards, e-mandates).
 * Configured by RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.
 * A `rzp_test_` key is test mode: no money moves and invoices are test invoices.
 */

const API = "https://api.razorpay.com/v1";

const KINDS: Record<string, BillingEventKind> = {
  "subscription.authenticated": "authenticated",
  "subscription.activated": "activated",
  "subscription.charged": "charged",
  "subscription.pending": "payment_failed",
  "subscription.halted": "halted",
  "subscription.cancelled": "cancelled",
  "subscription.completed": "cancelled",
  "subscription.updated": "updated",
};

type Entity = Record<string, unknown>;

function iso(unixSeconds: unknown) {
  return typeof unixSeconds === "number" && unixSeconds > 0 ? new Date(unixSeconds * 1000).toISOString() : undefined;
}

function str(v: unknown) {
  return typeof v === "string" && v ? v : undefined;
}

export function signRazorpay(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyRazorpaySignature(body: string, signature: string | null, secret: string | undefined) {
  if (!secret || !signature) return false;
  const want = Buffer.from(signRazorpay(body, secret));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A Razorpay webhook body → the provider-neutral event. */
export function parseRazorpayWebhook(body: string, headers: Headers, live: boolean): ParsedWebhook {
  const json = JSON.parse(body) as { event?: string; created_at?: number; payload?: Record<string, { entity?: Entity }> };
  const type = json.event ?? "unknown";
  const sub = json.payload?.subscription?.entity ?? {};
  const pay = json.payload?.payment?.entity;
  const notes = (sub.notes ?? {}) as Record<string, unknown>;
  const kind = KINDS[type] ?? "ignored";
  const event: BillingEvent = {
    kind,
    subscription_id: str(sub.id) ?? null,
    occurred_at: iso(json.created_at) ?? new Date().toISOString(),
    live,
  };
  const businessId = str(notes.business_id);
  if (businessId) event.business_id = businessId;
  if (iso(sub.current_start)) event.period_start = iso(sub.current_start);
  if (iso(sub.current_end)) event.period_end = iso(sub.current_end);
  if (pay && (kind === "charged" || kind === "activated") && pay.status === "captured" && typeof pay.amount === "number") {
    event.payment = {
      id: String(pay.id),
      amount: paiseToRupees(pay.amount),
      currency: str(pay.currency) ?? "INR",
      method: str(pay.method),
    };
  }
  if (pay) {
    const card = pay.card as Entity | undefined;
    const label =
      pay.method === "card" && card
        ? `${str(card.network) ?? "Card"} ending ${str(card.last4) ?? "····"}`
        : pay.method === "upi"
          ? `UPI ${str(pay.vpa) ?? "autopay"}`
          : str(pay.method);
    if (label) event.payment_method = { type: String(pay.method), label };
  }
  const eventId = headers.get("x-razorpay-event-id") ?? `${type}:${event.subscription_id}:${json.created_at ?? ""}:${event.payment?.id ?? ""}`;
  return { eventId, eventType: type, payload: json, event };
}

export function razorpayProvider(env: NodeJS.ProcessEnv = process.env): BillingProvider {
  const keyId = env.RAZORPAY_KEY_ID ?? "";
  const keySecret = env.RAZORPAY_KEY_SECRET ?? "";
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
  const live = keyId.startsWith("rzp_live_");
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: auth, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!res.ok) throw new Error(`Razorpay ${res.status}: ${json.error?.description ?? res.statusText}`);
    return json;
  }

  return {
    name: "razorpay",
    live,
    async createPlan({ planKey, planName, interval, amount, currency }) {
      const plan = await call<{ id: string }>("POST", "/plans", {
        period: interval,
        interval: 1,
        item: { name: `SCALER ${planName}`, amount: rupeesToPaise(amount), currency, description: `${planKey} ${interval}` },
        notes: { plan_key: planKey },
      });
      return plan.id;
    },
    async createSubscription({ providerPlanId, interval, businessId }) {
      const sub = await call<{ id: string; short_url: string; customer_id?: string | null }>("POST", "/subscriptions", {
        plan_id: providerPlanId,
        total_count: interval === "monthly" ? 120 : 10,
        quantity: 1,
        customer_notify: 1,
        notes: { business_id: businessId },
      });
      return { subscriptionId: sub.id, customerId: sub.customer_id ?? null, checkoutUrl: sub.short_url };
    },
    async changePlan(subscriptionId, providerPlanId, when) {
      await call("PATCH", `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        plan_id: providerPlanId,
        schedule_change_at: when,
        customer_notify: 1,
      });
    },
    async addCharge(subscriptionId, { name, amount, currency }) {
      await call("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/addons`, {
        item: { name, amount: rupeesToPaise(amount), currency },
      });
    },
    async cancel(subscriptionId) {
      await call("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { cancel_at_cycle_end: 1 });
    },
    verifyWebhook(body, headers) {
      return verifyRazorpaySignature(body, headers.get("x-razorpay-signature"), webhookSecret);
    },
    parseWebhook(body, headers) {
      return parseRazorpayWebhook(body, headers, live);
    },
  };
}
