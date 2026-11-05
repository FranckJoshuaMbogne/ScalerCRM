import { Suspense } from "react";
import { Wordmark } from "@/components/shell/wordmark";
import { brandStyle } from "@/modules/branding/brand";
import { hostBrand } from "@/modules/branding/host";

function DefaultAside() {
  return (
    <>
      <Wordmark />
      <div className="max-w-sm">
        <p className="text-[26px] leading-snug font-semibold text-white">
          Every enquiry, from first message to delivered order, in one place.
        </p>
        <ul className="mt-8 space-y-3 text-[14px] text-ink-muted">
          <li>Leads from Meta, Google, WhatsApp, your website and walk-ins</li>
          <li>One customer file per person, however many times they enquire</li>
          <li>Follow-ups, orders and payments with a clear owner</li>
        </ul>
      </div>
      <p className="text-[12px] text-ink-muted">SCALER by Springs 360</p>
    </>
  );
}

function BrandLogo({ name, logo, dark }: { name: string; logo: string | null; dark?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 ${dark ? "text-text" : "text-white"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo && <img src={`/brand/logo?v=${logo.slice(0, 12)}`} alt="" className="h-8 w-auto max-w-[140px] object-contain" />}
      <span className="text-[18px] font-semibold">{name}</span>
    </span>
  );
}

/** On a business's own domain, the sign-in pages carry its brand (ADR 0017). */
async function Aside() {
  const brand = await hostBrand();
  if (!brand) return <DefaultAside />;
  const vars = Object.entries(brandStyle(brand));
  return (
    <>
      {vars.length > 0 && <style>{`:root{${vars.map(([k, v]) => `${k}:${v}`).join(";")}}`}</style>}
      <BrandLogo name={brand.app_name} logo={brand.logo} />
      <div className="max-w-sm">
        <p className="text-[26px] leading-snug font-semibold text-white">{brand.signin_headline ?? `Welcome to ${brand.app_name}`}</p>
        {brand.signin_tagline && <p className="mt-6 text-[14px] text-ink-muted">{brand.signin_tagline}</p>}
        {(brand.support_email || brand.support_phone) && (
          <p className="mt-6 text-[13px] text-ink-muted">
            Help: {[brand.support_email, brand.support_phone].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <p className="text-[12px] text-ink-muted">{brand.powered_by ? "Powered by SCALER" : " "}</p>
    </>
  );
}

async function MobileMark() {
  const brand = await hostBrand();
  return brand ? <BrandLogo name={brand.app_name} logo={brand.logo} dark /> : <Wordmark tone="dark" />;
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="hidden flex-col justify-between bg-ink p-10 text-ink-fg lg:flex">
        {/* No fallback content: a tenant's domain must never flash SCALER's brand. */}
        <Suspense fallback={null}>
          <Aside />
        </Suspense>
      </aside>
      <main className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mb-10 lg:hidden">
          <Suspense fallback={<span className="block h-8" />}>
            <MobileMark />
          </Suspense>
        </div>
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
