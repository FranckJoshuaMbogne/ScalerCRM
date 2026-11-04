"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, fieldErrors, friendlyDbError } from "@/lib/forms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalisePhone } from "@/modules/crm/phone";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";
import { GST_STATES, isValidGstin, normaliseGstin } from "./gst";
import { ingestEvent } from "./ingest";
import { paiseToRupees, rupeesToPaise } from "./money";
import { billingProvider } from "./provider";
import { toQuote, getSubscription, type Quote } from "./queries";
import type { BillingEvent, BillingProvider, Interval } from "./types";

const NOT_CONFIGURED = "Online payment isn't set up yet. Contact Springs 360 to change your plan.";
const interval = z.enum(["monthly", "yearly"]);
const planKey = z.string().regex(/^[a-z][a-z0-9_]{1,30}$/);

/** A JSON number from Postgres numeric → "1234.50". */
const amount = (v: string | number) => paiseToRupees(rupeesToPaise(String(v)));

const profileSchema = z
  .object({
    legal_name: z.string().trim().min(2, "Enter the registered business name.").max(200),
    gstin: z
      .string()
      .trim()
      .transform((v) => (v ? normaliseGstin(v) : ""))
      .refine((v) => !v || isValidGstin(v), "That GSTIN isn't valid. Check it against your GST certificate."),
    country_code: z.string().trim().regex(/^[A-Z]{2}$/).default("IN"),
    state_code: z.string().trim().optional(),
    address: z.string().trim().min(5, "Enter the billing address.").max(400),
    city: z.string().trim().max(80).optional(),
    postal_code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 -]{3,12}$/, "Enter a valid PIN or postal code.")
      .or(z.literal(""))
      .optional(),
    billing_email: z.email("Enter the email invoices go to.").max(254),
    billing_phone: z.string().trim().max(30).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.country_code === "IN" && !v.gstin && !(v.state_code && v.state_code in GST_STATES))
      ctx.addIssue({ code: "custom", path: ["state_code"], message: "Choose your state (it decides CGST/SGST or IGST)." });
  });

export async function saveBillingProfile(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("billing.manage");
    const parsed = profileSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const v = parsed.data;
    const phone = v.billing_phone ? normalisePhone(v.billing_phone) : null;
    if (v.billing_phone && !phone)
      return { ok: false, message: "Check the highlighted fields.", fieldErrors: { billing_phone: "Enter a valid phone number." } };
    const supabase = await createClient();
    const { error } = await supabase.from("billing_profiles").upsert({
      business_id: ctx.business.businessId,
      legal_name: v.legal_name,
      gstin: v.gstin || null,
      country_code: v.country_code,
      state_code: v.country_code === "IN" ? (v.gstin ? v.gstin.slice(0, 2) : v.state_code) : null,
      address: v.address,
      city: v.city || null,
      postal_code: v.postal_code || null,
      billing_email: v.billing_email,
      billing_phone: phone,
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Billing details saved. They're printed on your next invoice." };
  });
}

/** The provider's plan for a plan, interval and amount; created on first use. */
async function providerPlanId(provider: BillingProvider, q: Quote) {
  const supabase = await createClient();
  const { data } = await supabase.from("plans").select("provider_plan_ids").eq("key", q.planKey).single();
  const ref = `${q.interval}:${amount(q.chargeAmount)}`;
  const existing = (data?.provider_plan_ids as Record<string, Record<string, string>> | undefined)?.[provider.name]?.[ref];
  if (existing) return existing;
  const id = await provider.createPlan({
    planKey: q.planKey,
    planName: q.planName,
    interval: q.interval,
    amount: amount(q.chargeAmount),
    currency: q.currency,
  });
  const { error } = await createAdminClient().rpc("billing_save_provider_plan", {
    p_provider: provider.name,
    p_plan_key: q.planKey,
    p_ref: ref,
    p_provider_plan_id: id,
  });
  if (error) throw new Error(`Could not save the provider plan: ${error.message}`);
  return id;
}

function readChoice(form: FormData) {
  const p = planKey.safeParse(form.get("plan"));
  const i = interval.safeParse(form.get("interval"));
  return p.success && i.success ? { plan: p.data, interval: i.data } : null;
}

/** Starts paying: creates the provider subscription and sends the customer to its checkout. */
export async function startCheckout(_: ActionState, form: FormData): Promise<ActionState> {
  let url: string | null = null;
  const result = await guard(async () => {
    const ctx = await requirePermission("billing.manage");
    const provider = billingProvider();
    if (!provider) return { ok: false, message: NOT_CONFIGURED };
    const choice = readChoice(form);
    if (!choice) return { ok: false, message: "Choose a plan." };
    const businessId = ctx.business.businessId;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("billing_begin_checkout", {
      p_business_id: businessId,
      p_plan_key: choice.plan,
      p_interval: choice.interval,
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    const q = toQuote(data as Record<string, unknown>);
    const previous = await getSubscription(businessId);
    try {
      const planId = await providerPlanId(provider, q);
      const sub = await provider.createSubscription({
        providerPlanId: planId,
        interval: choice.interval,
        businessId,
        email: String((data as Record<string, unknown>).billing_email),
        phone: ((data as Record<string, unknown>).billing_phone as string | null) ?? null,
      });
      const { error: attachError } = await supabase.rpc("billing_attach_subscription", {
        p_business_id: businessId,
        p_provider: provider.name,
        p_subscription_id: sub.subscriptionId,
        p_customer_id: sub.customerId,
        p_plan_key: choice.plan,
        p_interval: choice.interval,
        p_live: provider.live,
      });
      if (attachError) {
        await provider.cancel(sub.subscriptionId).catch(() => {});
        return { ok: false, message: friendlyDbError(attachError) };
      }
      // An abandoned or halted earlier subscription must not charge later.
      if (previous?.providerSubscriptionId && previous.provider === provider.name && previous.providerSubscriptionId !== sub.subscriptionId)
        await provider.cancel(previous.providerSubscriptionId).catch(() => {});
      url = sub.checkoutUrl;
    } catch (e) {
      console.error("[billing checkout]", e);
      return { ok: false, message: "The payment provider didn't respond. Nothing was charged. Try again in a minute." };
    }
    return { ok: true };
  });
  if (url) redirect(url);
  return result;
}

/** Upgrades now (the prorated difference is added to the next charge); anything else at renewal. */
export async function changePlan(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("billing.manage");
    const provider = billingProvider();
    if (!provider) return { ok: false, message: NOT_CONFIGURED };
    const choice = readChoice(form);
    if (!choice) return { ok: false, message: "Choose a plan." };
    const businessId = ctx.business.businessId;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("billing_quote", {
      p_business_id: businessId,
      p_plan_key: choice.plan,
      p_interval: choice.interval,
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    const q = toQuote(data as Record<string, unknown>);
    if (q.effective !== "now" && q.effective !== "renewal") return { ok: false, message: "That's already your plan." };
    if (q.blockers.length) return { ok: false, message: "Your business uses more than that plan allows. See the list above." };
    const sub = await getSubscription(businessId);
    if (!sub?.providerSubscriptionId || sub.provider !== provider.name) return { ok: false, message: NOT_CONFIGURED };
    try {
      await provider.changePlan(sub.providerSubscriptionId, await providerPlanId(provider, q), q.effective === "now" ? "now" : "cycle_end");
      if (q.effective === "now" && rupeesToPaise(String(q.prorationAmount)) > 0)
        await provider.addCharge(sub.providerSubscriptionId, {
          name: `Upgrade to ${q.planName} (rest of this period)`,
          amount: amount(q.prorationAmount),
          currency: q.currency,
        });
    } catch (e) {
      console.error("[billing change]", e);
      return { ok: false, message: "The payment provider didn't accept the change. Nothing was changed. Try again in a minute." };
    }
    const { error: recordError } = await supabase.rpc("billing_record_change", {
      p_business_id: businessId,
      p_plan_key: choice.plan,
      p_interval: choice.interval,
    });
    if (recordError) return { ok: false, message: friendlyDbError(recordError) };
    refresh();
    return {
      ok: true,
      message:
        q.effective === "now"
          ? `You're on ${q.planName} now. The difference for the rest of this period is added to your next payment.`
          : `You'll move to ${q.planName} at your next renewal.`,
    };
  });
}

export async function cancelSubscription(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("billing.manage");
    if (String(form.get("confirm") ?? "").trim().toLowerCase() !== "cancel")
      return { ok: false, message: 'Type "cancel" to confirm.' };
    const provider = billingProvider();
    const sub = await getSubscription(ctx.business.businessId);
    if (!provider || !sub?.providerSubscriptionId || sub.provider !== provider.name) return { ok: false, message: NOT_CONFIGURED };
    try {
      await provider.cancel(sub.providerSubscriptionId);
    } catch (e) {
      console.error("[billing cancel]", e);
      return { ok: false, message: "The payment provider didn't respond. Your subscription is unchanged. Try again in a minute." };
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("billing_cancel", { p_business_id: ctx.business.businessId });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Your subscription won't renew. Everything keeps working until the end of the period." };
  });
}

// ---------------------------------------------------------------------------
// Test mode only (the fake provider): play the provider's part.
// ---------------------------------------------------------------------------

function addInterval(from: Date, i: Interval) {
  const d = new Date(from);
  if (i === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

async function fakeContext() {
  const ctx = await requirePermission("billing.manage");
  const provider = billingProvider();
  if (provider?.name !== "fake") return null;
  const sub = await getSubscription(ctx.business.businessId);
  if (!sub?.providerSubscriptionId || sub.provider !== "fake") return null;
  return { ctx, sub, subId: sub.providerSubscriptionId };
}

async function chargeFor(businessId: string, plan: string, i: Interval) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("billing_quote", { p_business_id: businessId, p_plan_key: plan, p_interval: i });
  return data ? amount((data as Record<string, string | number>).charge_amount) : null;
}

function fakeEvent(subId: string, kind: BillingEvent["kind"], extra: Partial<BillingEvent> = {}): BillingEvent {
  return { kind, subscription_id: subId, occurred_at: new Date().toISOString(), live: false, ...extra };
}

async function fakeIngest(event: BillingEvent) {
  const id = `fevt_${crypto.randomUUID()}`;
  return ingestEvent("fake", id, `fake.${event.kind}`, { id, event }, event);
}

/** The test checkout page's buttons: the customer pays, or the payment fails. */
export async function fakeCheckout(_: ActionState, form: FormData): Promise<ActionState> {
  let done = false;
  const result = await guard(async () => {
    const f = await fakeContext();
    if (!f || !f.sub.checkoutPlanKey || !f.sub.providerSubscriptionId) return { ok: false, message: "No test checkout is open." };
    if (form.get("outcome") !== "pay") return { ok: true, message: "The test payment failed. Nothing was charged; try again." };
    const i = f.sub.checkoutInterval ?? "monthly";
    const total = await chargeFor(f.ctx.business.businessId, f.sub.checkoutPlanKey, i);
    if (!total) return { ok: false, message: "That plan has no price yet." };
    const now = new Date();
    const period = { period_start: now.toISOString(), period_end: addInterval(now, i).toISOString() };
    await fakeIngest(fakeEvent(f.subId, "activated", period));
    await fakeIngest(
      fakeEvent(f.subId, "charged", {
        ...period,
        payment: { id: `fpay_${crypto.randomUUID().slice(0, 12)}`, amount: total, currency: "INR", method: "upi" },
        payment_method: { type: "upi", label: "UPI test@fakebank" },
      }),
    );
    done = true;
    return { ok: true };
  });
  if (done) redirect("/settings/billing?paid=1");
  return result;
}

/** Billing page test controls: a renewal, a failed renewal, retries running out, the grace period ending. */
export async function fakeSimulate(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const f = await fakeContext();
    if (!f) return { ok: false, message: "Test controls work only with the test payment provider and a subscription." };
    const what = String(form.get("simulate") ?? "");
    const businessId = f.ctx.business.businessId;
    if (what === "renewal") {
      const plan = f.sub.pendingPlanKey ?? f.sub.planKey;
      const i = f.sub.pendingInterval ?? f.sub.interval ?? "monthly";
      const total = plan ? await chargeFor(businessId, plan, i) : null;
      if (!total) return { ok: false, message: "That plan has no price yet." };
      const start = new Date();
      await fakeIngest(
        fakeEvent(f.subId, "charged", {
          period_start: start.toISOString(),
          period_end: addInterval(start, i).toISOString(),
          payment: { id: `fpay_${crypto.randomUUID().slice(0, 12)}`, amount: total, currency: "INR", method: "upi" },
        }),
      );
    } else if (what === "failed") {
      await fakeIngest(fakeEvent(f.subId, "payment_failed"));
    } else if (what === "halted") {
      await fakeIngest(fakeEvent(f.subId, "halted"));
    } else if (what === "end_grace") {
      const admin = createAdminClient();
      const { error } = await admin
        .from("subscriptions")
        .update({ grace_ends_at: new Date(Date.now() - 60_000).toISOString() })
        .eq("business_id", businessId)
        .in("status", ["past_due", "grace"]);
      if (error) return { ok: false, message: friendlyDbError(error) };
      await admin.rpc("billing_tick");
    } else if (what === "cancelled") {
      await fakeIngest(fakeEvent(f.subId, "cancelled"));
    } else {
      return { ok: false, message: "Unknown test step." };
    }
    refresh();
    return { ok: true, message: "Done. The page shows the new state." };
  });
}
