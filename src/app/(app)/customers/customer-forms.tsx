"use client";

import { useActionState, useState } from "react";
import { CustomFieldInputs } from "@/components/crm/custom-field-inputs";
import { Field, FormMessage, SelectField, SubmitButton, TextAreaField } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import type { CustomValues, FieldDefinition } from "@/modules/custom-fields/engine";
import { addMeasurement } from "@/modules/measurements/actions";
import {
  addAddress,
  addContact,
  addCustomerNote,
  addTag,
  createCustomer,
  mergeCustomers,
  recordConsent,
  updateCustomer,
  uploadAttachment,
} from "@/modules/customers/actions";

type Option = { value: string; label: string };

export function NewCustomerForm({ branches }: { branches: Option[] }) {
  const [state, action] = useActionState(createCustomer, initialState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="fullName" required autoComplete="off" state={state} />
        <Field label="Phone" name="phone" type="tel" inputMode="tel" autoComplete="off" placeholder="98490 12345" state={state} />
        <Field label="Email" name="email" type="email" autoComplete="off" state={state} />
        {branches.length > 1 && (
          <SelectField label="Home branch" name="branchId" state={state}
            options={[{ value: "", label: "No particular branch" }, ...branches]} />
        )}
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Saving…">Save customer</SubmitButton>
      </div>
    </form>
  );
}

export function IdentityForm({
  customer,
  branches,
  fields,
}: {
  customer: {
    id: string;
    fullName: string;
    gender: string | null;
    dateOfBirth: string | null;
    preferredLanguage: string | null;
    branchId: string | null;
    customFields: CustomValues;
  };
  branches: Option[];
  fields: FieldDefinition[];
}) {
  const [state, action] = useActionState(updateCustomer, initialState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="customerId" value={customer.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="fullName" defaultValue={customer.fullName} required state={state} />
        <SelectField label="Gender" name="gender" defaultValue={customer.gender ?? ""} state={state}
          options={[
            { value: "", label: "Not recorded" },
            { value: "female", label: "Female" },
            { value: "male", label: "Male" },
            { value: "other", label: "Other" },
          ]} />
        <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={customer.dateOfBirth ?? ""} state={state} />
        <Field label="Preferred language" name="preferredLanguage" defaultValue={customer.preferredLanguage ?? ""} placeholder="Telugu" state={state} />
        {branches.length > 1 ? (
          <SelectField label="Home branch" name="branchId" defaultValue={customer.branchId ?? ""} state={state}
            options={[{ value: "", label: "No particular branch" }, ...branches]} />
        ) : (
          <input type="hidden" name="branchId" value={customer.branchId ?? ""} />
        )}
        <CustomFieldInputs definitions={fields} values={customer.customFields} state={state} idPrefix="cust" />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">Save customer</SubmitButton>
      </div>
    </form>
  );
}

export function AddContactForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState(addContact, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid gap-2 sm:grid-cols-[110px_1fr_120px_auto] sm:items-end">
        <SelectField label="Type" name="kind" id="contact-kind" state={state}
          options={[{ value: "phone", label: "Phone" }, { value: "email", label: "Email" }]} />
        <Field label="Number or email" name="value" id="contact-value" required autoComplete="off" state={state} />
        <Field label="Label" name="label" id="contact-label" placeholder="Work" state={state} />
        <SubmitButton variant="secondary" pendingLabel="Adding…">Add</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function AddAddressForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState(addAddress, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Label" name="label" id="addr-label" placeholder="Home" state={state} />
        <Field label="Address" name="line1" id="addr-line1" required className="sm:col-span-2" state={state} />
        <Field label="City" name="city" id="addr-city" state={state} />
        <Field label="State" name="state" id="addr-state" state={state} />
        <Field label="Postal code" name="postalCode" id="addr-pin" state={state} />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Adding…">Add address</SubmitButton>
      </div>
    </form>
  );
}

export function AddTagForm({ customerId, suggestions }: { customerId: string; suggestions: string[] }) {
  const [state, action] = useActionState(addTag, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="flex items-end gap-2">
        <Field label="Add tag" name="name" id="tag-name" list="tag-suggestions" autoComplete="off" placeholder="VIP" className="flex-1" state={state} />
        <SubmitButton variant="secondary" pendingLabel="…">Add</SubmitButton>
      </div>
      <datalist id="tag-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <FormMessage state={state} />
    </form>
  );
}

export function ConsentForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState(recordConsent, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Channel" name="channel" id="consent-channel" state={state}
          options={[
            { value: "whatsapp", label: "WhatsApp" },
            { value: "sms", label: "SMS" },
            { value: "email", label: "Email" },
            { value: "call", label: "Phone call" },
          ]} />
        <SelectField label="Purpose" name="purpose" id="consent-purpose" state={state}
          options={[{ value: "marketing", label: "Marketing" }, { value: "service", label: "Service updates" }]} />
        <SelectField label="Decision" name="status" id="consent-status" state={state}
          options={[{ value: "opted_in", label: "Opted in" }, { value: "opted_out", label: "Opted out" }]} />
      </div>
      <Field label="How was it given?" name="evidence" id="consent-evidence" placeholder="Said yes in store on 3 Nov, form signed" state={state} />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">Record consent</SubmitButton>
      </div>
    </form>
  );
}

export function NoteForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState(addCustomerNote, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="customerId" value={customerId} />
      <TextAreaField label="Note" name="body" id="customer-note" rows={2} required state={state} />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Adding…">Add note</SubmitButton>
      </div>
    </form>
  );
}

export function UploadForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState(uploadAttachment, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="File (up to 10 MB)" name="file" id="customer-file" type="file" required className="flex-1" state={state} />
        <SubmitButton variant="secondary" pendingLabel="Uploading…">Upload</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function MergeForm({ survivorId, duplicateId, label }: { survivorId: string; duplicateId: string; label: string }) {
  const [state, action] = useActionState(mergeCustomers, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="survivorId" value={survivorId} />
      <input type="hidden" name="duplicateId" value={duplicateId} />
      <label className="flex items-start gap-2 text-[13.5px]">
        <input type="checkbox" name="confirm" value="yes" className="mt-1" required />
        <span>{label}</span>
      </label>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="danger" pendingLabel="Merging…">Merge files</SubmitButton>
      </div>
    </form>
  );
}

export function MeasurementForm({
  customerId,
  templates,
}: {
  customerId: string;
  templates: { id: string; garment: string; fields: { key: string; label: string }[] }[];
}) {
  const [state, action] = useActionState(addMeasurement, initialState);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const template = templates.find((t) => t.id === templateId);
  if (!templates.length) return null;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Garment" name="templateId" id="m-template" value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          options={templates.map((t) => ({ value: t.id, label: t.garment }))} />
        <SelectField label="Unit" name="unit" id="m-unit" options={[{ value: "in", label: "Inches" }, { value: "cm", label: "Centimetres" }]} />
      </div>
      <div key={templateId} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {template?.fields.map((f) => (
          <Field key={f.key} label={f.label} name={`m_${f.key}`} id={`m-${f.key}`} inputMode="decimal" autoComplete="off" state={state} />
        ))}
      </div>
      <Field label="Notes" name="notes" id="m-notes" placeholder="Posture, fit preference…" state={state} />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">Save measurements</SubmitButton>
      </div>
    </form>
  );
}
