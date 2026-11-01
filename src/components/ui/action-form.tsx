"use client";

import { useActionState } from "react";
import { type ActionState, initialState } from "@/lib/forms";
import { FormMessage } from "./form";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

/** Small form bound to a server action, showing its result message underneath. */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, initialState);
  return (
    <form action={formAction} className={className}>
      {children}
      {state.message && (
        <div className="mt-2 basis-full">
          <FormMessage state={state} />
        </div>
      )}
    </form>
  );
}
