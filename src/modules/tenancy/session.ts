import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Permission } from "@/modules/permissions/catalog";

export const ACTIVE_BUSINESS_COOKIE = "scaler_business";

export type Membership = {
  membershipId: string;
  businessId: string;
  businessName: string;
  slug: string;
  countryCode: string;
  currency: string;
  timezone: string;
  roleKey: string;
  roleName: string;
  /** Suspended businesses are read-only (Sprint 10). */
  status: "active" | "suspended";
  /** A platform admin let in read-only by the business (support access). */
  support?: { until: string };
};

export type TenantContext = {
  user: { id: string; email: string; fullName: string | null; isPlatformAdmin: boolean };
  memberships: Membership[];
  business: Membership;
  permissions: ReadonlySet<Permission>;
};

type MembershipRow = {
  id: string;
  business: {
    id: string;
    name: string;
    slug: string;
    country_code: string;
    currency: string;
    timezone: string;
    status: "active" | "suspended" | "closed";
  } | null;
  role: { key: string; name: string } | null;
};

type BusinessRow = NonNullable<MembershipRow["business"]>;

function toMembership(id: string, b: BusinessRow, roleKey: string, roleName: string): Membership {
  return {
    membershipId: id,
    businessId: b.id,
    businessName: b.name,
    slug: b.slug,
    countryCode: b.country_code,
    currency: b.currency,
    timezone: b.timezone,
    roleKey,
    roleName,
    status: b.status === "suspended" ? "suspended" : "active",
  };
}

/** The signed-in user, verified against Supabase Auth (not just the cookie). */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

export const getProfile = cache(async () => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("full_name, is_platform_admin").eq("id", user.id).maybeSingle();
  return data as { full_name: string | null; is_platform_admin: boolean } | null;
});

/**
 * Active memberships for the signed-in user (suspended businesses included,
 * read-only), plus businesses that let this platform admin in for support.
 */
export const getMemberships = cache(async (): Promise<Membership[]> => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const columns = "id, name, slug, country_code, currency, timezone, status";
  const [{ data, error }, { data: grants }] = await Promise.all([
    supabase
      .from("business_memberships")
      .select(`id, business:businesses(${columns}), role:roles(key, name)`)
      .eq("user_id", user.id)
      .eq("status", "active")
      .returns<MembershipRow[]>(),
    // Only platform admins can read other businesses' grants (RLS).
    supabase
      .from("support_access_grants")
      .select(`id, expires_at, business:businesses(${columns})`)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .returns<{ id: string; expires_at: string; business: BusinessRow | null }[]>(),
  ]);
  if (error) throw new Error(`Could not load memberships: ${error.message}`);

  const own = (data ?? [])
    // RLS hides closed businesses, which leaves `business` null.
    .filter((m) => m.business && m.role && m.business.status !== "closed")
    .map((m) => toMembership(m.id, m.business!, m.role!.key, m.role!.name));
  const ownIds = new Set(own.map((m) => m.businessId));
  const support = (grants ?? [])
    .filter((g) => g.business && g.business.status !== "closed" && !ownIds.has(g.business.id))
    .map((g) => ({ ...toMembership(`support:${g.id}`, g.business!, "support", "SCALER support (read-only)"), support: { until: g.expires_at } }));
  const seen = new Set<string>();
  return [...own, ...support]
    .filter((m) => !seen.has(m.businessId) && seen.add(m.businessId))
    .sort((a, b) => a.businessName.localeCompare(b.businessName));
});

/**
 * Everything a workspace page needs: user, active business and permissions.
 * Redirects to /login or /onboarding when there is nothing to show.
 */
export const getContext = cache(async (): Promise<TenantContext> => {
  const user = await getUser();
  if (!user) redirect("/login");

  const [memberships, profile] = await Promise.all([getMemberships(), getProfile()]);
  if (memberships.length === 0) redirect(profile?.is_platform_admin ? "/platform" : "/onboarding");

  const wanted = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value;
  const business = memberships.find((m) => m.businessId === wanted) ?? memberships[0];

  const supabase = await createClient();
  const { data: perms, error } = await supabase.rpc("my_permissions", { p_business_id: business.businessId });
  if (error) throw new Error(`Could not load permissions: ${error.message}`);

  return {
    user: {
      id: user.id,
      email: user.email ?? "",
      fullName: profile?.full_name ?? null,
      isPlatformAdmin: profile?.is_platform_admin ?? false,
    },
    memberships,
    business,
    permissions: new Set((perms ?? []) as Permission[]),
  };
});

export function can(ctx: TenantContext, permission: Permission) {
  return ctx.permissions.has(permission);
}

/** For server actions: throws instead of rendering, so the action reports it. */
export async function requirePermission(permission: Permission) {
  const ctx = await getContext();
  if (!can(ctx, permission)) {
    throw new PermissionError(permission);
  }
  return ctx;
}

export class PermissionError extends Error {
  constructor(public permission: Permission) {
    super("You don't have permission to do that. Ask a business admin to change your role.");
  }
}

export function initials(name: string | null, email: string) {
  const source = name?.trim() || email.split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
