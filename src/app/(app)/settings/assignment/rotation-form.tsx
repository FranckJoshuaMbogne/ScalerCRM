"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { addToRotation } from "@/modules/assignment/actions";

export function AddToRotation({
  branchId,
  people,
}: {
  branchId: string | null;
  people: { value: string; label: string }[];
}) {
  const [state, action] = useActionState(addToRotation, initialState);
  const id = `rr-${branchId ?? "all"}`;
  if (!people.length) return <p className="text-[13px] text-muted">Everyone who can take leads here is already in this rotation.</p>;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="branchId" value={branchId ?? ""} />
      <div className="flex gap-2">
        <label htmlFor={id} className="sr-only">Person</label>
        <select
          id={id}
          name="userId"
          defaultValue=""
          className="h-9 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13.5px]"
        >
          <option value="" disabled>Add someone…</option>
          {people.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <SubmitButton variant="secondary" className="h-9 px-3 text-[13px]" pendingLabel="…">Add</SubmitButton>
      </div>
      {state.message && !state.ok && <FormMessage state={state} />}
    </form>
  );
}
