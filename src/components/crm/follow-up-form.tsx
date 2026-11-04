"use client";

import { useActionState } from "react";
import { Field, FormMessage, SelectField, SubmitButton, TextAreaField } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { createTask } from "@/modules/tasks/actions";

type Option = { value: string; label: string };

const TYPES: Option[] = [
  { value: "follow_up", label: "Follow-up" },
  { value: "call", label: "Call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "visit", label: "Store visit" },
  { value: "meeting", label: "Meeting" },
];

/**
 * Set a follow-up in two taps: pick a type, then a time button.
 * Preset times are resolved on the server when the form is sent.
 */
export function FollowUpForm({
  leadId,
  customerId,
  presets,
  assignees,
  defaultAssignee,
  minDate,
  idPrefix = "fu",
}: {
  leadId?: string;
  customerId?: string;
  presets: { key: string; label: string }[];
  assignees?: Option[];
  defaultAssignee?: string;
  minDate: string;
  idPrefix?: string;
}) {
  const [state, action] = useActionState(createTask, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      {leadId && <input type="hidden" name="leadId" value={leadId} />}
      {customerId && <input type="hidden" name="customerId" value={customerId} />}
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="mb-1.5 text-[13px] font-medium">Type</legend>
        {TYPES.map((t, i) => (
          <label
            key={t.value}
            className="cursor-pointer rounded-full border border-line px-3 py-1.5 text-[13px] has-[:checked]:border-signal has-[:checked]:bg-signal-soft has-[:checked]:font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-signal"
          >
            <input type="radio" name="type" value={t.value} defaultChecked={i === 0} className="sr-only" />
            {t.label}
          </label>
        ))}
      </fieldset>
      <Field label="What to do" name="title" id={`${idPrefix}-title`} placeholder="Optional, e.g. Confirm fitting date" maxLength={200} state={state} />
      {assignees && assignees.length > 1 && (
        <SelectField label="For" name="assigneeId" id={`${idPrefix}-assignee`} defaultValue={defaultAssignee} options={assignees} state={state} />
      )}
      <div>
        <p className="mb-1.5 text-[13px] font-medium">When</p>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <SubmitButton key={p.key} name="when" value={p.key} variant="secondary" className="h-9 px-3 text-[13px]">
              {p.label}
            </SubmitButton>
          ))}
        </div>
      </div>
      <details className="rounded-[var(--radius-control)] border border-line p-3">
        <summary className="cursor-pointer text-[13px] font-medium select-none">Pick a date and time</summary>
        <div className="mt-3 flex flex-col gap-3">
          <Field label="Due" name="dueAt" id={`${idPrefix}-due`} type="datetime-local" min={minDate} state={state} />
          <TextAreaField label="Notes" name="notes" id={`${idPrefix}-notes`} rows={2} state={state} />
          <div>
            <SubmitButton name="when" value="custom" pendingLabel="Saving…">Save follow-up</SubmitButton>
          </div>
        </div>
      </details>
      <FormMessage state={state} />
    </form>
  );
}
