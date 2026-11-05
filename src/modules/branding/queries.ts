import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getContext } from "@/modules/tenancy/session";
import { type Brand, DEFAULT_BRAND } from "./brand";
import type { DnsRecord } from "./providers";
import { hostBrand } from "./host";


/** The brand the app shows: the domain's business, else the active business's own brand. */
export const appBrand = cache(async (): Promise<Brand & { assetQuery: string }> => {
  const fromHost = await hostBrand();
  if (fromHost) return { ...fromHost, assetQuery: "" };
  const ctx = await getContext();
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_brand", { p_business_id: ctx.business.businessId });
  const brand = data ? { ...DEFAULT_BRAND, ...(data as Partial<Brand>) } : DEFAULT_BRAND;
  return { ...brand, assetQuery: `b=${ctx.business.businessId}&` };
});

export type BrandSettings = {
  brand: {
    app_name: string;
    short_name: string;
    primary_color: string;
    sidebar_color: string;
    support_email: string | null;
    support_phone: string | null;
    signin_headline: string | null;
    signin_tagline: string | null;
    hide_powered_by: boolean;
  } | null;
  assets: { logo: string | null; icon: string | null };
  domains: { id: string; hostname: string; status: string; instructions: DnsRecord[]; error: string | null; verified_at: string | null; last_checked_at: string | null }[];
  email: { domain: string; from_local: string; status: string; records: DnsRecord[]; error: string | null; verified_at: string | null } | null;
  whiteLabel: boolean;
};

export async function getBrandSettings(businessId: string): Promise<BrandSettings> {
  const supabase = await createClient();
  const [brand, assets, domains, email, plan] = await Promise.all([
    supabase.from("business_brands").select("app_name, short_name, primary_color, sidebar_color, support_email, support_phone, signin_headline, signin_tagline, hide_powered_by").eq("business_id", businessId).maybeSingle(),
    supabase.rpc("my_brand", { p_business_id: businessId }),
    supabase.from("custom_domains").select("id, hostname, status, instructions, error, verified_at, last_checked_at").eq("business_id", businessId).order("created_at"),
    supabase.from("email_domains").select("domain, from_local, status, records, error, verified_at").eq("business_id", businessId).maybeSingle(),
    supabase.rpc("white_label_enabled", { p_business_id: businessId }),
  ]);
  const b = (assets.data ?? {}) as Partial<Brand>;
  return {
    brand: brand.data ?? null,
    assets: { logo: b.logo ?? null, icon: b.icon ?? null },
    domains: (domains.data ?? []) as BrandSettings["domains"],
    email: (email.data ?? null) as BrandSettings["email"],
    whiteLabel: plan.data === true,
  };
}
