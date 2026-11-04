import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Activation = {
  businessId: string;
  name: string;
  createdAt: string;
  templateKey: string | null;
  setupCompletedAt: string | null;
  firstLeadAt: string | null;
  firstReplyAt: string | null;
  firstOrderAt: string | null;
  planKey: string;
  billingStatus: string | null;
};

export async function listActivation(days = 90): Promise<Activation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_activation", { p_days: days });
  if (error) throw new Error(`Could not load activation: ${error.message}`);
  return ((data ?? []) as Record<string, string | null>[]).map((r) => ({
    businessId: r.business_id!,
    name: r.name!,
    createdAt: r.created_at!,
    templateKey: r.template_key,
    setupCompletedAt: r.setup_completed_at,
    firstLeadAt: r.first_lead_at,
    firstReplyAt: r.first_reply_at,
    firstOrderAt: r.first_order_at,
    planKey: r.plan_key!,
    billingStatus: r.billing_status,
  }));
}

export type WhatsappReview = {
  accountId: string;
  businessId: string;
  businessName: string;
  displayPhone: string | null;
  verifiedName: string | null;
  connectedAt: string;
  adminEmail: string | null;
  leads: number;
};

export async function listWhatsappReviews(): Promise<WhatsappReview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_whatsapp_reviews");
  if (error) throw new Error(`Could not load the review queue: ${error.message}`);
  return ((data ?? []) as Record<string, string | number | null>[]).map((r) => ({
    accountId: String(r.account_id),
    businessId: String(r.business_id),
    businessName: String(r.business_name),
    displayPhone: (r.display_phone as string | null) ?? null,
    verifiedName: (r.verified_name as string | null) ?? null,
    connectedAt: String(r.connected_at),
    adminEmail: (r.admin_email as string | null) ?? null,
    leads: Number(r.leads ?? 0),
  }));
}

/** Hours from sign-up to a milestone, or null if not reached. */
export function hoursSince(from: string, to: string | null) {
  if (!to) return null;
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 36_000) / 100);
}
