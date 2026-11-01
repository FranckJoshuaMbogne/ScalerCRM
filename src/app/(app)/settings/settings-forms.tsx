"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { saveBranch, updateBusiness } from "@/modules/settings/actions";
import type { BusinessProfile } from "@/modules/settings/queries";
import type { Branch } from "@/modules/team/queries";

export function BusinessForm({ profile, disabled }: { profile: BusinessProfile; disabled: boolean }) {
  const [state, action] = useActionState(updateBusiness, initialState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" name="name" defaultValue={profile.name} required state={state} />
        <Field label="Legal name" name="legalName" defaultValue={profile.legalName ?? ""} hint="As registered, for invoices." state={state} />
        <Field label="Industry" name="industry" defaultValue={profile.industry ?? ""} placeholder="Bespoke tailoring" state={state} />
        <Field label="Country code" name="countryCode" defaultValue={profile.countryCode} maxLength={2} state={state} />
        <Field label="Currency" name="currency" defaultValue={profile.currency} maxLength={3} state={state} />
        <Field label="Time zone" name="timezone" defaultValue={profile.timezone} state={state} />
      </fieldset>
      <FormMessage state={state} />
      {!disabled && (
        <div>
          <SubmitButton pendingLabel="Saving…">Save business details</SubmitButton>
        </div>
      )}
    </form>
  );
}

export function BranchForm({ branch }: { branch?: Branch }) {
  const [state, action] = useActionState(saveBranch, initialState);
  const p = branch?.id ?? "new";
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="branchId" value={branch?.id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Branch name" name="name" id={`${p}-name`} defaultValue={branch?.name} required state={state} />
        <Field label="Short code" name="code" id={`${p}-code`} defaultValue={branch?.code ?? ""} placeholder="HYD" state={state} />
        <Field label="Phone" name="phone" id={`${p}-phone`} type="tel" defaultValue={branch?.phone ?? ""} state={state} />
        <Field label="Address" name="addressLine" id={`${p}-addr`} defaultValue={branch?.addressLine ?? ""} className="sm:col-span-3" state={state} />
        <Field label="City" name="city" id={`${p}-city`} defaultValue={branch?.city ?? ""} state={state} />
        <Field label="State" name="state" id={`${p}-state`} defaultValue={branch?.state ?? ""} state={state} />
        <Field label="Postal code" name="postalCode" id={`${p}-pin`} defaultValue={branch?.postalCode ?? ""} state={state} />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant={branch ? "secondary" : "primary"} pendingLabel="Saving…">
          {branch ? "Save branch" : "Add branch"}
        </SubmitButton>
      </div>
    </form>
  );
}
