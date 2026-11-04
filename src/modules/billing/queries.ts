import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Interval, SubscriptionStatus } from "./types";

export type Subscription = {
  status: SubscriptionStatus;
  provider: "razorpay" | "fake" | null;
  providerSubscriptionId: string | null;
  live: boolean;
  planKey: string | null;
  interval: Interval | null;
  checkoutPlanKey: string | null;
  checkoutInterval: Interval | null;
  pendingPlanKey: string | null;
  pendingInterval: Interval | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  graceEndsAt: string | null;
  readOnlySince: string | null;
  paymentMethod: { type: string; label: string } | null;
};

export type BillingProfile = {
  legalName: string;
  gstin: string | null;
  countryCode: string;
  stateCode: string | null;
  address: string;
  city: string | null;
  postalCode: string | null;
  billingEmail: string;
  billingPhone: string | null;
};

export type InvoiceSummary = {
  id: string;
  number: string;
  issuedAt: string;
  description: string;
  total: string;
  currency: string;
  testMode: boolean;
};

export type Quote = {
  planKey: string;
  planName: string;
  interval: Interval;
  price: string;
  chargeAmount: string;
  currency: string;
  gstRate: string;
  effective: "checkout" | "now" | "renewal" | "same";
  prorationAmount: string;
  blockers: { key: string; uses: number; allows: number }[];
  renewsAt: string | null;
};

export async function getSubscription(businessId: string): Promise<Subscription | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("subscriptions").select("*").eq("business_id", businessId).maybeSingle();
  if (error) throw new Error(`Could not load the subscription: ${error.message}`);
  if (!data) return null;
  return {
    status: data.status,
    provider: data.provider,
    providerSubscriptionId: data.provider_subscription_id,
    live: data.live,
    planKey: data.plan_key,
    interval: data.billing_interval,
    checkoutPlanKey: data.checkout_plan_key,
    checkoutInterval: data.checkout_interval,
    pendingPlanKey: data.pending_plan_key,
    pendingInterval: data.pending_interval,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    graceEndsAt: data.grace_ends_at,
    readOnlySince: data.read_only_since,
    paymentMethod: data.payment_method,
  };
}

export async function getBillingProfile(businessId: string): Promise<BillingProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("billing_profiles").select("*").eq("business_id", businessId).maybeSingle();
  if (error) throw new Error(`Could not load billing details: ${error.message}`);
  if (!data) return null;
  return {
    legalName: data.legal_name,
    gstin: data.gstin,
    countryCode: data.country_code,
    stateCode: data.state_code,
    address: data.address,
    city: data.city,
    postalCode: data.postal_code,
    billingEmail: data.billing_email,
    billingPhone: data.billing_phone,
  };
}

export async function listInvoices(businessId: string): Promise<InvoiceSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, number, issued_at, description, total, currency, test_mode")
    .eq("business_id", businessId)
    .order("issued_at", { ascending: false })
    .limit(36);
  if (error) throw new Error(`Could not load invoices: ${error.message}`);
  return (data ?? []).map((i) => ({
    id: i.id,
    number: i.number,
    issuedAt: i.issued_at,
    description: i.description,
    total: String(i.total),
    currency: i.currency,
    testMode: i.test_mode,
  }));
}

export type Invoice = {
  id: string;
  number: string;
  testMode: boolean;
  issuedAt: string;
  paidAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  description: string;
  seller: Record<string, string | null>;
  buyer: Record<string, string | null>;
  sacCode: string;
  gstRate: string;
  placeOfSupply: string | null;
  supplyType: "intra_state" | "inter_state" | "export";
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  currency: string;
  paymentId: string;
};

export async function getInvoice(id: string): Promise<Invoice | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the invoice: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    number: data.number,
    testMode: data.test_mode,
    issuedAt: data.issued_at,
    paidAt: data.paid_at,
    periodStart: data.period_start,
    periodEnd: data.period_end,
    description: data.description,
    seller: data.seller,
    buyer: data.buyer,
    sacCode: data.sac_code,
    gstRate: String(data.gst_rate),
    placeOfSupply: data.place_of_supply,
    supplyType: data.supply_type,
    taxable: String(data.taxable_amount),
    cgst: String(data.cgst),
    sgst: String(data.sgst),
    igst: String(data.igst),
    total: String(data.total),
    currency: data.currency,
    paymentId: data.provider_payment_id,
  };
}

export function toQuote(d: Record<string, unknown>): Quote {
  return {
    planKey: String(d.plan_key),
    planName: String(d.plan_name),
    interval: d.interval as Interval,
    price: String(d.price),
    chargeAmount: String(d.charge_amount),
    currency: String(d.currency ?? "INR"),
    gstRate: String(d.gst_rate ?? "18"),
    effective: d.effective as Quote["effective"],
    prorationAmount: String(d.proration_amount ?? "0"),
    blockers: (d.blockers as Quote["blockers"]) ?? [],
    renewsAt: (d.renews_at as string | null) ?? null,
  };
}

/** What switching to a plan would do, or an error message (e.g. not on sale). */
export async function getQuote(businessId: string, planKey: string, interval: string): Promise<Quote | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_quote", {
    p_business_id: businessId,
    p_plan_key: planKey,
    p_interval: interval,
  });
  if (error) return { error: error.message };
  return toQuote(data as Record<string, unknown>);
}
