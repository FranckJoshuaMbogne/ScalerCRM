import Link from "next/link";
import { brandStyle } from "@/modules/branding/brand";
import { appBrand } from "@/modules/branding/queries";
import { Wordmark } from "./wordmark";

/** Recolours the app for a branded business (validated #rrggbb colours only). */
export async function BrandStyle() {
  const brand = await appBrand();
  const vars = Object.entries(brandStyle(brand));
  if (!vars.length) return null;
  return <style>{`:root{${vars.map(([k, v]) => `${k}:${v}`).join(";")}}`}</style>;
}

/** The business's logo and name in the sidebar, or SCALER's wordmark. */
export async function BrandMark({ className }: { className?: string }) {
  const brand = await appBrand();
  if (!brand.branded) return <Wordmark className={className} />;
  return (
    <Link href="/dashboard" aria-label={`${brand.app_name} home`} className={`flex items-center gap-2.5 text-white ${className ?? ""}`}>
      {brand.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/brand/logo?${brand.assetQuery}v=${brand.logo.slice(0, 12)}`} alt="" className="h-7 w-auto max-w-[120px] rounded-sm object-contain" />
      ) : null}
      <span className="truncate text-[16px] font-semibold">{brand.app_name}</span>
    </Link>
  );
}

export async function BrandShortName() {
  const brand = await appBrand();
  return <span className="font-semibold tracking-[0.04em] lg:hidden">{brand.branded ? brand.short_name : "SCALER"}</span>;
}

/** "Powered by SCALER" under a business's brand, unless their plan lets them hide it. */
export async function PoweredBy({ className }: { className?: string }) {
  const brand = await appBrand();
  if (!brand.branded || !brand.powered_by) return null;
  return <p className={`text-[11.5px] text-ink-muted ${className ?? ""}`}>Powered by SCALER</p>;
}
