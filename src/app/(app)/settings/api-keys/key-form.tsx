"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { createApiKey } from "@/modules/api/actions";

export function CreateKeyForm() {
  const [state, action] = useActionState(createApiKey, initialState);
  const [copied, setCopied] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Name" name="name" required placeholder="Website contact form" className="min-w-[240px] flex-1" state={state} />
        <SubmitButton pendingLabel="Creating…">Create key</SubmitButton>
      </div>
      <FormMessage state={state} />
      {state.ok && state.data?.key && (
        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-paper p-2">
          <input
            readOnly
            value={state.data.key}
            aria-label="New API key"
            className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[12.5px] outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(state.data!.key);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] bg-surface px-3 text-[13px] font-medium shadow-sm"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </form>
  );
}
