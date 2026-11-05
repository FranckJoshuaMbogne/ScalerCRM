import type { MetadataRoute } from "next";
import { brandManifest, DEFAULT_BRAND } from "@/modules/branding/brand";
import { hostBrand } from "@/modules/branding/host";

/** Per domain: a business's own domain installs as their app, with their name and icon (ADR 0017). */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  return brandManifest((await hostBrand()) ?? DEFAULT_BRAND);
}
