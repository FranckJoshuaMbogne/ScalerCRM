"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { acceptInvitation } from "@/modules/tenancy/actions";

export function AcceptForm({ token }: { token: string }) {
  const [state, action] = useActionState(acceptInvitation, initialState);
  return (
    <form action={action} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Joining…">Accept invitation</SubmitButton>
    </form>
  );
}
