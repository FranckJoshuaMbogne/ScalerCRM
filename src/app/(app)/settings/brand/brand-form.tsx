"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { saveBrand } from "@/modules/branding/actions";
import { contrastRatio, readableWithWhite } from "@/modules/branding/brand";

type Brand = {
  app_name: string;
  short_name: string;
  primary_color: string;
  sidebar_color: string;
  support_email: string | null;
  support_phone: string | null;
  signin_headline: string | null;
  signin_tagline: string | null;
  hide_powered_by: boolean;
};

function ColourField({ label, name, value, onChange }: { label: string; name: string; value: string; onChange: (v: string) => void }) {
  const ok = readableWithWhite(value);
  return (
    <div>
      <span className="mb-1 block text-[13px] font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 rounded border border-line bg-surface" />
        <input name={name} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-28 rounded-[var(--radius-control)] border border-line bg-surface px-2 font-mono text-[13px]" />
        <span className="rounded px-2 py-1 text-[12.5px] font-medium text-white" style={{ background: /^#[0-9a-f]{6}$/i.test(value) ? value : "#999" }}>Aa</span>
      </div>
      <p className={`mt-1 text-[12px] ${ok ? "text-muted" : "text-danger"}`}>
        {/^#[0-9a-f]{6}$/i.test(value) ? `Contrast with white text ${contrastRatio(value, "#ffffff")}:1${ok ? "" : ", too low (needs 4.5:1)"}` : "Use #rrggbb"}
      </p>
    </div>
  );
}

export function BrandForm({ brand, defaultName, whiteLabel }: { brand: Brand | null; defaultName: string; whiteLabel: boolean }) {
  const [state, action] = useActionState(saveBrand, initialState);
  const [primary, setPrimary] = useState(brand?.primary_color ?? "#2f6bff");
  const [sidebar, setSidebar] = useState(brand?.sidebar_color ?? "#0e1b33");
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="App name" name="appName" defaultValue={brand?.app_name ?? defaultName} maxLength={40} required hint="Shown in the app, on sign-in and when installed." />
        <Field label="Short name" name="shortName" defaultValue={brand?.short_name ?? defaultName.slice(0, 12)} maxLength={12} required hint="Under the home-screen icon." />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ColourField label="Main colour (buttons, links)" name="primaryColor" value={primary} onChange={setPrimary} />
        <ColourField label="Sidebar colour" name="sidebarColor" value={sidebar} onChange={setSidebar} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Support email" name="supportEmail" type="email" defaultValue={brand?.support_email ?? ""} />
        <Field label="Support phone" name="supportPhone" defaultValue={brand?.support_phone ?? ""} />
      </div>
      <Field label="Sign-in page headline" name="signinHeadline" defaultValue={brand?.signin_headline ?? ""} maxLength={120} hint="On your own domain's sign-in page." />
      <Field label="Sign-in page text" name="signinTagline" defaultValue={brand?.signin_tagline ?? ""} maxLength={300} />
      <label className={`flex items-start gap-2 text-[13.5px] ${whiteLabel ? "" : "text-muted"}`}>
        <input type="checkbox" name="hidePoweredBy" defaultChecked={brand?.hide_powered_by} disabled={!whiteLabel} className="mt-1" />
        <span>
          Hide &quot;Powered by SCALER&quot;
          {!whiteLabel && <span className="block text-[12.5px]">Comes with the Scale plan and above.</span>}
        </span>
      </label>
      <div><SubmitButton>Save brand</SubmitButton></div>
      <FormMessage state={state} />
    </form>
  );
}
