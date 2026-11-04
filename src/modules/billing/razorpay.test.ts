import { describe, expect, it } from "vitest";
import { fakeProvider, fakeWebhookBody, signFake } from "./fake";
import { selectProvider } from "./provider";
import { parseRazorpayWebhook, razorpayProvider, signRazorpay, verifyRazorpaySignature } from "./razorpay";

const charged = {
  entity: "event",
  event: "subscription.charged",
  created_at: 1_808_000_000,
  payload: {
    subscription: {
      entity: {
        id: "sub_00000000000001",
        status: "active",
        current_start: 1_808_000_000,
        current_end: 1_810_592_000,
        notes: { business_id: "4e1c1b3a-0000-4000-8000-000000000001" },
      },
    },
    payment: {
      entity: { id: "pay_00000000000001", amount: 294882, currency: "INR", status: "captured", method: "upi", vpa: "kai@okbank" },
    },
  },
};

describe("Razorpay webhooks", () => {
  const body = JSON.stringify(charged);

  it("verifies the signature over the raw body", () => {
    const sig = signRazorpay(body, "whsec_test");
    expect(verifyRazorpaySignature(body, sig, "whsec_test")).toBe(true);
    expect(verifyRazorpaySignature(body + " ", sig, "whsec_test")).toBe(false);
    expect(verifyRazorpaySignature(body, sig, undefined)).toBe(false);
    expect(verifyRazorpaySignature(body, null, "whsec_test")).toBe(false);
  });

  it("turns a charge into a payment in rupees, with the period and business", () => {
    const parsed = parseRazorpayWebhook(body, new Headers({ "x-razorpay-event-id": "evt_1" }), false);
    expect(parsed.eventId).toBe("evt_1");
    expect(parsed.event).toMatchObject({
      kind: "charged",
      subscription_id: "sub_00000000000001",
      business_id: "4e1c1b3a-0000-4000-8000-000000000001",
      payment: { id: "pay_00000000000001", amount: "2948.82", currency: "INR", method: "upi" },
      payment_method: { type: "upi", label: "UPI kai@okbank" },
      live: false,
    });
    expect(parsed.event.period_start).toBe(new Date(1_808_000_000_000).toISOString());
  });

  it("maps the subscription lifecycle and ignores the rest", () => {
    const kind = (event: string) =>
      parseRazorpayWebhook(JSON.stringify({ ...charged, event }), new Headers(), false).event.kind;
    expect(kind("subscription.pending")).toBe("payment_failed");
    expect(kind("subscription.halted")).toBe("halted");
    expect(kind("subscription.cancelled")).toBe("cancelled");
    expect(kind("subscription.completed")).toBe("cancelled");
    expect(kind("payment.captured")).toBe("ignored");
  });

  it("never invoices a payment that wasn't captured", () => {
    const failed = structuredClone(charged);
    failed.payload.payment.entity.status = "failed";
    expect(parseRazorpayWebhook(JSON.stringify(failed), new Headers(), false).event.payment).toBeUndefined();
  });

  it("is test mode unless the key is live", () => {
    expect(razorpayProvider({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s" } as unknown as NodeJS.ProcessEnv).live).toBe(false);
    expect(razorpayProvider({ RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "s" } as unknown as NodeJS.ProcessEnv).live).toBe(true);
  });
});

describe("fake provider", () => {
  it("signs and parses its own events, always as test mode", () => {
    const p = fakeProvider({} as unknown as NodeJS.ProcessEnv);
    const body = fakeWebhookBody("fevt_1", {
      kind: "activated",
      subscription_id: "fsub_1",
      occurred_at: "2027-04-19T00:00:00Z",
      live: true,
    });
    expect(p.verifyWebhook(body, new Headers({ "x-fake-signature": signFake(body) }))).toBe(true);
    expect(p.verifyWebhook(body, new Headers({ "x-fake-signature": "nope" }))).toBe(false);
    expect(p.parseWebhook(body, new Headers()).event.live).toBe(false);
  });
});

describe("provider selection", () => {
  const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
  it("uses Razorpay when keys are set", () => {
    expect(selectProvider(env({ NODE_ENV: "production", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s" }))?.name).toBe("razorpay");
  });
  it("uses the fake provider in development and previews", () => {
    expect(selectProvider(env({ NODE_ENV: "development" }))?.name).toBe("fake");
    expect(selectProvider(env({ NODE_ENV: "production", VERCEL_ENV: "preview" }))?.name).toBe("fake");
  });
  it("never the fake provider in production, even when asked", () => {
    expect(selectProvider(env({ NODE_ENV: "production" }))).toBeNull();
    expect(selectProvider(env({ NODE_ENV: "production", BILLING_PROVIDER: "fake" }))).toBeNull();
  });
});
