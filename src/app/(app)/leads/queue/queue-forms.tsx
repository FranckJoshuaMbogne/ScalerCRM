"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { assignInRotation, assignLead } from "@/modules/assignment/actions";

type Option = { value: string; label: string };

export function AssignOne({ leadId, owners }: { leadId: string; owners: Option[] }) {
  const [state, action] = useActionState(assignLead, initialState);
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`owner-${leadId}`}>Owner</label>
        <select
          id={`owner-${leadId}`}
          name="ownerId"
          defaultValue=""
          className="h-9 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13px]"
        >
          <option value="" disabled>Assign to…</option>
          {owners.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <SubmitButton variant="secondary" className="h-9 px-3 text-[13px]" pendingLabel="…">Assign</SubmitButton>
      </div>
      {state.message && !state.ok && <FormMessage state={state} />}
    </form>
  );
}

/**
 * Header bar for the queue. Row checkboxes sit outside this form (each row has
 * its own assign form) and join it through form="rotation".
 */
export function RotationForm({ count }: { count: number }) {
  const [state, action] = useActionState(assignInRotation, initialState);
  return (
    <form id="rotation" action={action} className="border-b border-line">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <label className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              document
                .querySelectorAll<HTMLInputElement>('input[name="leadIds"][form="rotation"]')
                .forEach((box) => (box.checked = checked));
            }}
          />
          Select all {count}
        </label>
        <SubmitButton variant="secondary" pendingLabel="Assigning…">Hand out in rotation</SubmitButton>
      </div>
      {state.message && (
        <div className="px-5 pb-3">
          <FormMessage state={state} />
        </div>
      )}
    </form>
  );
}
