import "server-only";
import { headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import { createAnonClient } from "@/lib/supabase/anon";
import { type Brand, DEFAULT_BRAND, normaliseHost } from "./brand";

/** The host this request came in on. */
export async function requestHost(): Promise<string> {
  // Never prerender: the answer depends on the domain the request came in on.
  await connection();
  const h = await headers();
  return normaliseHost(h.get("x-forwarded-host") ?? h.get("host"));
}

/** SCALER's own hosts (the configured site URL, localhost, previews): no tenant brand. */
export function isPlatformHost(host: string): boolean {
  const site = process.env.NEXT_PUBLIC_SITE_URL ? normaliseHost(new URL(process.env.NEXT_PUBLIC_SITE_URL).host) : null;
  return !host || host === site || host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app");
}

/**
 * The brand of the business that owns this host (its custom domain), or null
 * on SCALER's own domain. Public: it is shown before anyone signs in.
 */
export const hostBrand = cache(async (): Promise<Brand | null> => {
  const host = await requestHost();
  if (isPlatformHost(host)) return null;
  const { data, error } = await createAnonClient().rpc("brand_for_host", { p_host: host });
  if (error || !data) return null;
  return { ...DEFAULT_BRAND, ...(data as Partial<Brand>) };
});
