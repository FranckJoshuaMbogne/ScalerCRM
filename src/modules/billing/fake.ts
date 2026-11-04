import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { BillingEvent, BillingProvider, ParsedWebhook } from "./types";

/**
 * A provider that moves no money, for development, previews and tests. Checkout is a
 * page in SCALER with "pay" and "fail" buttons; its events go through the same ingest
 * and state machine as Razorpay's. Never enabled in production (see provider.ts).
 */

export function fakeSecret(env: NodeJS.ProcessEnv = process.env) {
  return env.BILLING_FAKE_SECRET || "scaler-fake-billing-secret";
}

export function signFake(body: string, secret = fakeSecret()) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** A fake webhook body: the neutral event plus an id. */
export function fakeWebhookBody(id: string, event: BillingEvent) {
  return JSON.stringify({ id, event });
}

export function fakeProvider(env: NodeJS.ProcessEnv = process.env): BillingProvider {
  const secret = fakeSecret(env);
  return {
    name: "fake",
    live: false,
    async createPlan({ planKey, interval, amount }) {
      return `fplan_${planKey}_${interval}_${amount.replace(".", "_")}`;
    },
    async createSubscription() {
      const id = `fsub_${randomBytes(8).toString("hex")}`;
      return {
        subscriptionId: id,
        customerId: `fcust_${randomBytes(6).toString("hex")}`,
        checkoutUrl: `/settings/billing/test-checkout?subscription=${id}`,
      };
    },
    async changePlan() {},
    async addCharge() {},
    async cancel() {},
    verifyWebhook(body, headers) {
      const got = Buffer.from(headers.get("x-fake-signature") ?? "");
      const want = Buffer.from(signFake(body, secret));
      return got.length === want.length && timingSafeEqual(got, want);
    },
    parseWebhook(body): ParsedWebhook {
      const json = JSON.parse(body) as { id?: string; event?: BillingEvent };
      if (!json.id || !json.event?.kind) throw new Error("not a fake billing event");
      return { eventId: json.id, eventType: `fake.${json.event.kind}`, payload: json, event: { ...json.event, live: false } };
    },
  };
}
