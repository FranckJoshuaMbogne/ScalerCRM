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
};

export type TenantContext = {
  user: { id: string; email: string; fullName: string | null };
  memberships: Membership[];
  business: Membership;
  permissions: ReadonlySet<Permission>;
};

type MembershipRow = {
  id: string;
  business: { id: string; name: string; slug: string; country_code: string; currency: string; timezone: string } | null;
  role: { key: string; name: string } | null;
};

/** The signed-in user, verified against Supabase Auth (not just the cookie). */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

/** Active memberships in active businesses for the signed-in user. */
export const getMemberships = cache(async (): Promise<Membership[]> => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_memberships")
    .select("id, business:businesses(id, name, slug, country_code, currency, timezone), role:roles(key, name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .returns<MembershipRow[]>();
  if (error) throw new Error(`Could not load memberships: ${error.message}`);

  return (data ?? [])
    // RLS hides suspended businesses, which leaves `business` null.
    .filter((m) => m.business && m.role)
    .map((m) => ({
      membershipId: m.id,
      businessId: m.business!.id,
      businessName: m.business!.name,
      slug: m.business!.slug,
      countryCode: m.business!.country_code,
      currency: m.business!.currency,
      timezone: m.business!.timezone,
      roleKey: m.role!.key,
      roleName: m.role!.name,
    }))
    .sort((a, b) => a.businessName.localeCompare(b.businessName));
});

/**
 * Everything a workspace page needs: user, active business and permissions.
 * Redirects to /login or /onboarding when there is nothing to show.
 */
export const getContext = cache(async (): Promise<TenantContext> => {
  const user = await getUser();
  if (!user) redirect("/login");

  const memberships = await getMemberships();
  if (memberships.length === 0) redirect("/onboarding");

  const wanted = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value;
  const business = memberships.find((m) => m.businessId === wanted) ?? memberships[0];

  const supabase = await createClient();
  const [{ data: perms, error }, { data: profile }] = await Promise.all([
    supabase.rpc("my_permissions", { p_business_id: business.businessId }),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  if (error) throw new Error(`Could not load permissions: ${error.message}`);

  return {
    user: { id: user.id, email: user.email ?? "", fullName: profile?.full_name ?? null },
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
