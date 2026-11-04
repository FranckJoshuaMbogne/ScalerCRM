"use client";

import { useActionState } from "react";
import { Field, FormMessage, SelectField, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { saveBillingProfile } from "@/modules/billing/actions";
import { GST_STATES } from "@/modules/billing/gst";
import type { BillingProfile } from "@/modules/billing/queries";

const STATES = [
  { value: "", label: "Choose…" },
  ...Object.entries(GST_STATES)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label)),
];

export function BillingProfileForm({ profile, fallbackName }: { profile: BillingProfile | null; fallbackName: string }) {
  const [state, action] = useActionState(saveBillingProfile, initialState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="country_code" value={profile?.countryCode ?? "IN"} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Registered name" name="legal_name" defaultValue={profile?.legalName ?? fallbackName} required state={state} />
        <Field
          label="GSTIN (optional)"
          name="gstin"
          defaultValue={profile?.gstin ?? ""}
          maxLength={20}
          hint="Add it to claim input tax credit. It also sets your state."
          state={state}
        />
        <Field label="Address" name="address" defaultValue={profile?.address ?? ""} required className="sm:col-span-2" state={state} />
        <Field label="City" name="city" defaultValue={profile?.city ?? ""} state={state} />
        <Field label="PIN code" name="postal_code" defaultValue={profile?.postalCode ?? ""} inputMode="numeric" state={state} />
        <SelectField
          label="State (place of supply)"
          name="state_code"
          defaultValue={profile?.stateCode ?? ""}
          options={STATES}
          state={state}
        />
        <Field label="Invoice email" name="billing_email" type="email" defaultValue={profile?.billingEmail ?? ""} required state={state} />
        <Field label="Phone (optional)" name="billing_phone" type="tel" defaultValue={profile?.billingPhone ?? ""} state={state} />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Saving…">Save billing details</SubmitButton>
      </div>
    </form>
  );
}
