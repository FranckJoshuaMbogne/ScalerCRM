"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SelectField, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { createBusiness } from "@/modules/tenancy/actions";
import { slugify } from "@/modules/tenancy/slug";

const REGIONS = [
  { value: "IN|INR|Asia/Kolkata", label: "India (₹ INR, IST)" },
  { value: "US|USD|America/Chicago", label: "United States, Central (US$ USD)" },
  { value: "US|USD|America/Los_Angeles", label: "United States, Pacific (US$ USD)" },
  { value: "US|USD|America/New_York", label: "United States, Eastern (US$ USD)" },
  { value: "AE|AED|Asia/Dubai", label: "United Arab Emirates (AED)" },
  { value: "GB|GBP|Europe/London", label: "United Kingdom (£ GBP)" },
  { value: "CM|XAF|Africa/Douala", label: "Cameroon (FCFA XAF)" },
  { value: "FR|EUR|Europe/Paris", label: "France (€ EUR)" },
];

export function OnboardingForm() {
  const [state, action] = useActionState(createBusiness, initialState);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [region, setRegion] = useState(REGIONS[0].value);
  const [countryCode, currency, timezone] = region.split("|");

  return (
    <form action={action} className="flex flex-col gap-5">
      <Field
        label="Business name"
        name="name"
        required
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!slugEdited) setSlug(slugify(e.target.value));
        }}
        placeholder="My Perfect Fit"
        state={state}
      />
      <Field
        label="Web address"
        name="slug"
        required
        value={slug}
        onChange={(e) => {
          setSlugEdited(true);
          setSlug(e.target.value);
        }}
        hint="A short name for your workspace. Lowercase letters, numbers and hyphens."
        state={state}
      />
      <Field label="First branch or store" name="branchName" required placeholder="Hyderabad studio" state={state} />
      <SelectField
        label="Country, currency and time zone"
        name="region"
        value={region}
        onChange={(e) => setRegion(e.target.value)}
        options={REGIONS}
      />
      <input type="hidden" name="countryCode" value={countryCode} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="timezone" value={timezone} />
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Creating your workspace…">Create workspace</SubmitButton>
    </form>
  );
}
