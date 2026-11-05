import "server-only";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getUser } from "@/modules/tenancy/session";
import type { LimitKey, Limits } from "./limits";

/** Platform pages and actions: signed-in platform admins only; everyone else gets a 404. */
export async function requirePlatformAdmin() {
  const [user, profile] = await Promise.all([getUser(), getProfile()]);
  if (!user || !profile?.is_platform_admin) notFound();
  return user;
}

export type PlatformBusiness = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "closed";
  planKey: string;
  trialEndsAt: string | null;
  createdAt: string;
  adminEmail: string | null;
  usage: Partial<Record<LimitKey, number>>;
  leads30d: number;
  supportOpen: boolean;
};

export async function listPlatformBusinesses(): Promise<PlatformBusiness[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_businesses");
  if (error) throw new Error(`Could not load businesses: ${error.message}`);
  type Row = {
    id: string; name: string; slug: string; status: PlatformBusiness["status"]; plan_key: string;
    trial_ends_at: string | null; created_at: string; admin_email: string | null;
    usage: PlatformBusiness["usage"]; leads_30d: number; support_open: boolean;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    planKey: r.plan_key,
    trialEndsAt: r.trial_ends_at,
    createdAt: r.created_at,
    adminEmail: r.admin_email,
    usage: r.usage ?? {},
    leads30d: Number(r.leads_30d),
    supportOpen: r.support_open,
  }));
}

export type PlatformBusinessDetail = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "closed";
  statusReason: string | null;
  planKey: string;
  planOverrides: Limits;
  trialEndsAt: string | null;
  createdAt: string;
  timezone: string;
  usage: Partial<Record<LimitKey, number>>;
  limits: Limits;
  members: { name: string | null; email: string; role: string }[];
  history: { plan_key: string; status: string; overrides: Limits; trial_ends_at: string | null; reason: string | null; at: string; by: string | null }[];
  health: {
    whatsapp: { display: string; status: string }[];
    webhook_failures_24h: number;
    automation_failures_7d: number;
    ad_account_errors: number;
  };
  supportUntil: string | null;
};

export async function getPlatformBusiness(id: string): Promise<PlatformBusinessDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_business", { p_business_id: id });
  if (error) {
    if (error.code === "P0002" || error.code === "22P02") return null;
    throw new Error(`Could not load the business: ${error.message}`);
  }
  const d = data as Record<string, unknown>;
  return {
    id: d.id as string,
    name: d.name as string,
    slug: d.slug as string,
    status: d.status as PlatformBusinessDetail["status"],
    statusReason: (d.status_reason as string | null) ?? null,
    planKey: d.plan_key as string,
    planOverrides: (d.plan_overrides as Limits) ?? {},
    trialEndsAt: (d.trial_ends_at as string | null) ?? null,
    createdAt: d.created_at as string,
    timezone: d.timezone as string,
    usage: (d.usage as PlatformBusinessDetail["usage"]) ?? {},
    limits: (d.limits as Limits) ?? {},
    members: (d.members as PlatformBusinessDetail["members"]) ?? [],
    history: (d.history as PlatformBusinessDetail["history"]) ?? [],
    health: d.health as PlatformBusinessDetail["health"],
    supportUntil: (d.support_until as string | null) ?? null,
  };
}
