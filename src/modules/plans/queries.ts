import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { LimitKey, Limits } from "./limits";

export type BusinessPlan = {
  planKey: string;
  planName: string;
  status: "active" | "suspended" | "closed";
  statusReason: string | null;
  suspendedBy: "platform" | "billing" | null;
  trialEndsAt: string | null;
  billingStatus: "trialing" | "active" | "past_due" | "grace" | "read_only" | "cancelled" | null;
  graceEndsAt: string | null;
  limits: Limits;
  usage: Partial<Record<LimitKey, number>>;
  supportUntil: string | null;
};

export async function getBusinessPlan(businessId: string): Promise<BusinessPlan> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("business_plan", { p_business_id: businessId });
  if (error) throw new Error(`Could not load the plan: ${error.message}`);
  const d = data as Record<string, unknown>;
  return {
    planKey: d.plan_key as string,
    planName: (d.plan_name as string) ?? (d.plan_key as string),
    status: d.status as BusinessPlan["status"],
    statusReason: (d.status_reason as string | null) ?? null,
    suspendedBy: (d.suspended_by as BusinessPlan["suspendedBy"]) ?? null,
    trialEndsAt: (d.trial_ends_at as string | null) ?? null,
    billingStatus: (d.billing_status as BusinessPlan["billingStatus"]) ?? null,
    graceEndsAt: (d.grace_ends_at as string | null) ?? null,
    limits: (d.limits as Limits) ?? {},
    usage: (d.usage as BusinessPlan["usage"]) ?? {},
    supportUntil: (d.support_until as string | null) ?? null,
  };
}

export type Plan = {
  key: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  limits: Limits;
  priceMonthly: string | null;
  priceYearly: string | null;
  currency: string;
};

export async function listPlans(): Promise<Plan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("plans").select("*").order("position");
  if (error) throw new Error(`Could not load plans: ${error.message}`);
  return (data ?? []).map((p) => ({
    key: p.key,
    name: p.name,
    description: p.description,
    isPublic: p.is_public,
    limits: {
      max_users: p.max_users,
      max_branches: p.max_branches,
      max_whatsapp_numbers: p.max_whatsapp_numbers,
      monthly_messages: p.monthly_messages,
      max_automations: p.max_automations,
      daily_api_calls: p.daily_api_calls,
    },
    priceMonthly: p.price_monthly,
    priceYearly: p.price_yearly,
    currency: p.currency,
  }));
}
