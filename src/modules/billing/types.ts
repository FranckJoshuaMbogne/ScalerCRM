/** Provider-neutral billing types. The database state machine reads `BillingEvent` (private.billing_apply). */

export type Interval = "monthly" | "yearly";

export type BillingEventKind =
  | "authenticated"
  | "activated"
  | "charged"
  | "payment_failed"
  | "halted"
  | "cancelled"
  | "updated"
  | "ignored";

export type BillingEvent = {
  kind: BillingEventKind;
  subscription_id: string | null;
  /** From the subscription's notes; the database checks it matches. */
  business_id?: string;
  occurred_at: string;
  period_start?: string;
  period_end?: string;
  /** Amount in rupees as a decimal string, GST included. */
  payment?: { id: string; amount: string; currency: string; method?: string };
  payment_method?: { type: string; label: string };
  live: boolean;
};

export type ParsedWebhook = {
  eventId: string;
  eventType: string;
  payload: unknown;
  event: BillingEvent;
};

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "grace" | "read_only" | "cancelled";

export interface BillingProvider {
  readonly name: "razorpay" | "fake";
  /** True for real money (a live key). Test-mode payments only ever get test invoices. */
  readonly live: boolean;
  /** Creates the provider's plan for a price (GST included). */
  createPlan(input: { planKey: string; planName: string; interval: Interval; amount: string; currency: string }): Promise<string>;
  /** Starts a subscription; the customer pays on `checkoutUrl`. */
  createSubscription(input: {
    providerPlanId: string;
    interval: Interval;
    businessId: string;
    email: string;
    phone: string | null;
  }): Promise<{ subscriptionId: string; customerId: string | null; checkoutUrl: string }>;
  changePlan(subscriptionId: string, providerPlanId: string, when: "now" | "cycle_end"): Promise<void>;
  /** A one-off amount (GST included) added to the next charge, e.g. an upgrade's proration. */
  addCharge(subscriptionId: string, input: { name: string; amount: string; currency: string }): Promise<void>;
  cancel(subscriptionId: string): Promise<void>;
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  parseWebhook(rawBody: string, headers: Headers): ParsedWebhook;
}
