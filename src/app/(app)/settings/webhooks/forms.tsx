"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { createWebhookEndpoint, rotateWebhookSecret, saveWebhookEvents } from "@/modules/webhooks/actions";
import { WEBHOOK_EVENTS } from "@/modules/webhooks/events";

export function SecretBox({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-paper p-2">
      <input
        readOnly
        value={secret}
        aria-label="Signing secret"
        className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[12.5px] outline-none"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(secret);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] bg-surface px-3 text-[13px] font-medium shadow-sm"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function EventChoices({ selected, error }: { selected?: string[]; error?: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium">Events to send</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {WEBHOOK_EVENTS.map((e) => (
          <label key={e.type} className="flex items-start gap-2 text-[13.5px]">
            <input type="checkbox" name="events" value={e.type} defaultChecked={selected ? selected.includes(e.type) : true} className="mt-1" />
            <span>
              {e.label} <code className="text-[12px] text-muted">{e.type}</code>
              <span className="block text-[12.5px] text-muted">{e.description}</span>
            </span>
          </label>
        ))}
      </div>
      {error && <p className="mt-1 text-[12.5px] text-danger">{error}</p>}
    </fieldset>
  );
}

export function CreateEndpointForm() {
  const [state, action] = useActionState(createWebhookEndpoint, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="URL" name="url" required type="url" placeholder="https://example.com/scaler-webhook" state={state} />
        <Field label="Description" name="description" placeholder="ERP order sync" state={state} />
      </div>
      <EventChoices error={state.fieldErrors?.events} />
      <div>
        <SubmitButton pendingLabel="Adding…">Add endpoint</SubmitButton>
      </div>
      <FormMessage state={state} />
      {state.ok && state.data?.secret && (
        <>
          <SecretBox secret={state.data.secret} />
          <Link href={`/settings/webhooks/${state.data.id}`} className="text-[13.5px] text-signal hover:underline">
            Open the endpoint and send a test event
          </Link>
        </>
      )}
    </form>
  );
}

export function EventsForm({ endpointId, selected }: { endpointId: string; selected: string[] }) {
  const [state, action] = useActionState(saveWebhookEvents, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="endpointId" value={endpointId} />
      <EventChoices selected={selected} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">Save events</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function RotateSecretForm({ endpointId }: { endpointId: string }) {
  const [state, action] = useActionState(rotateWebhookSecret, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="endpointId" value={endpointId} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Making…">Make a new secret</SubmitButton>
      </div>
      <FormMessage state={state} />
      {state.ok && state.data?.secret && <SecretBox secret={state.data.secret} />}
    </form>
  );
}
