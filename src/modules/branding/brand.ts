/**
 * White-label brands (ADR 0017). Pure: colours, contrast, hostnames, the
 * manifest and which business a request belongs to.
 */
import type { MetadataRoute } from "next";

export type Brand = {
  business_id: string | null;
  app_name: string;
  short_name: string;
  primary_color: string;
  sidebar_color: string;
  support_email: string | null;
  support_phone: string | null;
  signin_headline: string | null;
  signin_tagline: string | null;
  powered_by: boolean;
  logo: string | null;
  icon: string | null;
  branded: boolean;
};

export const DEFAULT_BRAND: Brand = {
  business_id: null,
  app_name: "SCALER",
  short_name: "SCALER",
  primary_color: "#2f6bff",
  sidebar_color: "#0e1b33",
  support_email: null,
  support_phone: null,
  signin_headline: null,
  signin_tagline: null,
  powered_by: true,
  logo: null,
  icon: null,
  branded: false,
};

const HEX = /^#[0-9a-f]{6}$/i;

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio, 1 to 21 (same as private.contrast_ratio). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** White text on this colour is readable (WCAG AA, normal text). */
export function readableWithWhite(hex: string): boolean {
  return HEX.test(hex) && contrastRatio(hex, "#ffffff") >= 4.5;
}

/** A darker shade for hover states. */
export function darken(hex: string, amount = 0.15): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.round(c * (1 - amount))).toString(16).padStart(2, "0");
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

/** CSS variables that recolour the app for a brand (only what the brand sets). */
export function brandStyle(brand: Brand): Record<string, string> {
  if (!brand.branded) return {};
  return {
    "--signal": brand.primary_color,
    "--signal-strong": darken(brand.primary_color),
    "--ink": brand.sidebar_color,
  };
}

/** Lower case, no port, no trailing dot. */
export function normaliseHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().split(":")[0].replace(/\.$/, "");
}

const HOSTNAME = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const RESERVED = /(^|\.)(scalercrm\.com|springs360\.com|vercel\.app|vercel\.com|supabase\.co|supabase\.com|localhost|local|internal)$/;

/** Null when a business may use this as its domain, otherwise why not. */
export function checkHostname(raw: string): string | null {
  const host = normaliseHost(raw);
  if (!HOSTNAME.test(host) || host.length > 253) return "Enter a domain like crm.yourbrand.in, without https://.";
  if (RESERVED.test(host)) return "Use a domain you own.";
  return null;
}

/** The PWA manifest for a brand: its name and icon, so the installed app is theirs. */
export function brandManifest(brand: Brand): MetadataRoute.Manifest {
  const icon = brand.icon
    ? [
        { src: `/brand/icon?v=${brand.icon.slice(0, 12)}`, sizes: "512x512", type: "image/png", purpose: "any" as const },
        { src: `/brand/icon?v=${brand.icon.slice(0, 12)}`, sizes: "192x192", type: "image/png", purpose: "any" as const },
      ]
    : [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" as const },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" as const },
        { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" as const },
      ];
  const small = icon[icon.length > 2 ? 0 : 1].src;
  return {
    name: brand.branded ? brand.app_name : "SCALER CRM",
    short_name: brand.short_name,
    description: "Leads, customers, WhatsApp and orders for your business.",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: brand.sidebar_color,
    icons: icon,
    shortcuts: [
      { name: "Today's tasks", url: "/tasks", icons: [{ src: small, sizes: "192x192" }] },
      { name: "Inbox", url: "/inbox", icons: [{ src: small, sizes: "192x192" }] },
    ],
  };
}

/**
 * Which business a request works in. On a business's own domain it is always
 * that business, and someone who isn't a member gets nothing (no cross-tenant
 * session). Elsewhere it's the business chosen in the cookie, or the first.
 */
export function resolveActiveBusiness<T extends { businessId: string }>(
  memberships: T[],
  hostBusinessId: string | null,
  cookieBusinessId: string | undefined,
): { business: T | null; mismatch: boolean; locked: boolean } {
  if (hostBusinessId) {
    const own = memberships.find((m) => m.businessId === hostBusinessId) ?? null;
    return { business: own, mismatch: !own, locked: true };
  }
  return { business: memberships.find((m) => m.businessId === cookieBusinessId) ?? memberships[0] ?? null, mismatch: false, locked: false };
}

/** PNG or WebP by their first bytes (the database checks the same). */
export function imageType(bytes: Uint8Array): "image/png" | "image/webp" | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
