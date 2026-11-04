"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { cancelTask, completeTask, reassignTask, rescheduleTask } from "@/modules/tasks/actions";

type Option = { value: string; label: string };

/** Done / snooze / cancel controls for one open task. */
export function TaskActions({
  taskId,
  presets,
  assignees,
  assigneeId,
}: {
  taskId: string;
  presets: { key: string; label: string }[];
  assignees?: Option[];
  assigneeId?: string | null;
}) {
  const [doneState, done] = useActionState(completeTask, initialState);
  const [moveState, move] = useActionState(rescheduleTask, initialState);
  const [cancelState, cancel] = useActionState(cancelTask, initialState);
  const [assignState, assign] = useActionState(reassignTask, initialState);
  const message = [doneState, moveState, cancelState, assignState].find((s) => s.message && !s.ok);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={done} className="flex items-center gap-2">
          <input type="hidden" name="taskId" value={taskId} />
          <label className="sr-only" htmlFor={`outcome-${taskId}`}>Outcome</label>
          <input
            id={`outcome-${taskId}`}
            name="outcome"
            placeholder="Outcome (optional)"
            maxLength={2000}
            className="h-9 w-40 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[13px] focus:border-signal focus:outline-none sm:w-52"
          />
          <SubmitButton variant="secondary" className="h-9 px-3 text-[13px]" pendingLabel="…">
            <Check className="size-4" /> Done
          </SubmitButton>
        </form>
        <details className="relative">
          <summary className="flex h-9 cursor-pointer items-center rounded-[var(--radius-control)] px-2.5 text-[13px] text-muted select-none hover:bg-paper">
            More
          </summary>
          <div className="absolute right-0 z-10 mt-1 flex w-60 flex-col gap-2 rounded-[var(--radius-control)] border border-line bg-surface p-3 shadow-lg">
            <form action={move} className="flex flex-col gap-1.5">
              <input type="hidden" name="taskId" value={taskId} />
              <p className="text-[12px] font-medium text-muted">Move to</p>
              {presets.map((p) => (
                <SubmitButton key={p.key} name="when" value={p.key} variant="ghost" className="h-8 justify-start text-text">
                  {p.label}
                </SubmitButton>
              ))}
            </form>
            {assignees && assignees.length > 1 && (
              <form action={assign} className="flex flex-col gap-1.5 border-t border-line pt-2">
                <input type="hidden" name="taskId" value={taskId} />
                <label htmlFor={`assign-${taskId}`} className="text-[12px] font-medium text-muted">Give to</label>
                <select
                  id={`assign-${taskId}`}
                  name="assigneeId"
                  defaultValue={assigneeId ?? ""}
                  className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[13px]"
                >
                  {assignees.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
                <SubmitButton variant="secondary" className="h-8 text-[13px]">Reassign</SubmitButton>
              </form>
            )}
            <form action={cancel} className="border-t border-line pt-2">
              <input type="hidden" name="taskId" value={taskId} />
              <SubmitButton variant="ghost" className="h-8 w-full justify-start text-danger">Cancel task</SubmitButton>
            </form>
          </div>
        </details>
      </div>
      {message && <FormMessage state={message} />}
    </div>
  );
}
