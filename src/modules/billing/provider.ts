import { fakeProvider } from "./fake";
import { razorpayProvider } from "./razorpay";
import type { BillingProvider } from "./types";

/**
 * The configured payment provider, or null when billing isn't set up.
 * - Razorpay when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set (or BILLING_PROVIDER=razorpay).
 * - The fake provider in development and previews, never in production.
 */
export function selectProvider(env: NodeJS.ProcessEnv = process.env): BillingProvider | null {
  const production = env.NODE_ENV === "production" && (env.VERCEL_ENV ?? "production") === "production";
  const wanted = env.BILLING_PROVIDER ?? (env.RAZORPAY_KEY_ID ? "razorpay" : production ? "" : "fake");
  if (wanted === "razorpay" && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) return razorpayProvider(env);
  if (wanted === "fake" && !production) return fakeProvider(env);
  return null;
}

export function billingProvider() {
  return selectProvider();
}

export function providerByName(name: string): BillingProvider | null {
  const p = selectProvider();
  return p && p.name === name ? p : null;
}
