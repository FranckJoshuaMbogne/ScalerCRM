"use client";

import { useActionState, useRef, useState } from "react";
import { CustomFieldInputs } from "@/components/crm/custom-field-inputs";
import { Field, FormMessage, SelectField, SubmitButton, TextAreaField } from "@/components/ui/form";
import { type ActionState, initialState } from "@/lib/forms";
import type { CustomValues, FieldDefinition } from "@/modules/custom-fields/engine";
import { changeLeadStatus, createLead, logLeadActivity, updateLead } from "@/modules/leads/actions";

type Option = { value: string; label: string };

export function NewLeadForm({
  customer,
  statuses,
  sources,
  branches,
  owners,
  fields,
  currency,
}: {
  customer: { id: string; label: string } | null;
  statuses: (Option & { isDefault: boolean })[];
  sources: Option[];
  branches: Option[];
  owners: Option[];
  fields: FieldDefinition[];
  currency: string;
}) {
  const [state, action] = useActionState(createLead, initialState);
  return (
    <form action={action} className="flex flex-col gap-5">
      {customer ? (
        <div className="flex flex-col gap-4">
          <input type="hidden" name="customerId" value={customer.id} />
          <p className="text-[14px]">
            <span className="font-semibold">Customer:</span> {customer.label}
          </p>
          {branches.length > 1 && (
            <SelectField label="Branch" name="branchId" state={state} className="max-w-sm"
              options={[{ value: "", label: "No particular branch" }, ...branches]} />
          )}
        </div>
      ) : (
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-[14px] font-semibold">Customer</legend>
        <Field label="Phone" name="phone" type="tel" inputMode="tel" autoComplete="off" placeholder="98490 12345"
          hint="Matched against existing customers. Add the country code for numbers outside your country." state={state} />
        <Field label="Name" name="fullName" required autoComplete="off" state={state} />
        <Field label="Email" name="email" type="email" autoComplete="off" hint="Used to match only when there's no phone." state={state} />
        {branches.length > 1 && (
          <SelectField label="Branch" name="branchId" state={state}
            options={[{ value: "", label: "No particular branch" }, ...branches]} />
        )}
      </fieldset>
      )}

      <fieldset className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
        <legend className="mb-3 pt-5 text-[14px] font-semibold">Enquiry</legend>
        <SelectField label="Source" name="sourceId" state={state} defaultValue={sources[0]?.value} options={sources} />
        <SelectField label="Status" name="statusId" state={state}
          defaultValue={statuses.find((s) => s.isDefault)?.value} options={statuses} />
        <Field label="Interested in" name="title" placeholder="Wedding sherwani" state={state} />
        <Field label={`Expected value (${currency})`} name="expectedValue" inputMode="decimal" placeholder="25000" state={state} />
        <Field label="Campaign" name="campaign" hint="Optional. Ad or offer name, if known." state={state} />
        {owners.length > 0 && (
          <SelectField label="Owner" name="ownerId" state={state}
            options={[{ value: "", label: "Unassigned" }, ...owners]} />
        )}
        <TextAreaField label="Notes" name="description" className="sm:col-span-2" state={state} />
        <CustomFieldInputs definitions={fields} state={state} idPrefix="new" />
      </fieldset>

      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Saving…">Save lead</SubmitButton>
      </div>
    </form>
  );
}

export function EditLeadForm({
  lead,
  branches,
  owners,
  fields,
  currency,
  canAssign,
}: {
  lead: {
    id: string;
    title: string | null;
    description: string | null;
    expectedValue: string | null;
    branchId: string | null;
    ownerId: string | null;
    customFields: CustomValues;
  };
  branches: Option[];
  owners: Option[];
  fields: FieldDefinition[];
  currency: string;
  canAssign: boolean;
}) {
  const [state, action] = useActionState(updateLead, initialState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="leadId" value={lead.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Interested in" name="title" defaultValue={lead.title ?? ""} state={state} />
        <Field label={`Expected value (${currency})`} name="expectedValue" inputMode="decimal"
          defaultValue={lead.expectedValue ?? ""} state={state} />
        {branches.length > 1 ? (
          <SelectField label="Branch" name="branchId" defaultValue={lead.branchId ?? ""} state={state}
            options={[{ value: "", label: "No particular branch" }, ...branches]} />
        ) : (
          <input type="hidden" name="branchId" value={lead.branchId ?? ""} />
        )}
        {canAssign && (
          <SelectField label="Owner" name="ownerId" defaultValue={lead.ownerId ?? ""} state={state}
            options={[{ value: "", label: "Unassigned" }, ...owners]} />
        )}
        <TextAreaField label="Notes" name="description" defaultValue={lead.description ?? ""} className="sm:col-span-2" state={state} />
        <CustomFieldInputs definitions={fields} values={lead.customFields} state={state} idPrefix="edit" />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">Save changes</SubmitButton>
      </div>
    </form>
  );
}

export function StatusForm({
  leadId,
  statusId,
  statuses,
  lostReasons,
  lostReasonId,
}: {
  leadId: string;
  statusId: string;
  statuses: (Option & { category: "open" | "won" | "lost" })[];
  lostReasons: Option[];
  lostReasonId?: string | null;
}) {
  const [picked, setPicked] = useState(statusId);
  const [state, action] = useActionState(async (prev: ActionState, form: FormData) => {
    const result = await changeLeadStatus(prev, form);
    // A refused move (pipeline rule, missing owner) snaps the picker back.
    if (!result.ok && !result.fieldErrors?.lostReasonId) setPicked(statusId);
    return result;
  }, initialState);
  const ref = useRef<HTMLFormElement>(null);
  const lost = statuses.find((s) => s.value === picked)?.category === "lost";
  // Lost stages need a reason, so they wait for the button; other moves save on change.
  const needsConfirm = lost && picked !== statusId;
  return (
    <form ref={ref} action={action} className="flex flex-col gap-3">
      <input type="hidden" name="leadId" value={leadId} />
      <SelectField
        label="Stage"
        name="statusId"
        id="lead-status"
        value={picked}
        options={statuses}
        onChange={(e) => {
          setPicked(e.target.value);
          const next = statuses.find((s) => s.value === e.target.value);
          if (next?.category !== "lost") queueMicrotask(() => ref.current?.requestSubmit());
        }}
      />
      {lost && (
        <>
          <SelectField
            label="Why was it lost?"
            name="lostReasonId"
            id="lead-lost-reason"
            defaultValue={lostReasonId ?? ""}
            options={[{ value: "", label: "Choose a reason" }, ...lostReasons]}
            required
            state={state}
          />
          <TextAreaField label="Note" name="lostNote" id="lead-lost-note" rows={2} maxLength={1000}
            placeholder="Optional. What would have changed their mind?" state={state} />
          <div>
            <SubmitButton variant={needsConfirm ? "danger" : "secondary"} pendingLabel="Saving…">
              {needsConfirm ? "Mark as lost" : "Update reason"}
            </SubmitButton>
          </div>
        </>
      )}
      <noscript>
        <SubmitButton variant="secondary">Update stage</SubmitButton>
      </noscript>
      <FormMessage state={state} />
    </form>
  );
}

export function ActivityForm({ leadId }: { leadId: string }) {
  const [state, action] = useActionState(logLeadActivity, initialState);
  // React resets the form after the action runs; a failed note is echoed back.
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13.5px]">
        {[
          ["note", "Note"],
          ["call", "Call"],
          ["whatsapp", "WhatsApp"],
          ["visit", "Store visit"],
          ["meeting", "Meeting"],
        ].map(([value, label], i) => (
          <label key={value} className="flex items-center gap-1.5">
            <input type="radio" name="type" value={value} defaultChecked={i === 0} />
            {label}
          </label>
        ))}
      </div>
      <TextAreaField label="What happened" name="body" required rows={2} placeholder="Called, wants a fitting on Saturday" state={state} />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Adding…">Add to timeline</SubmitButton>
      </div>
    </form>
  );
}
