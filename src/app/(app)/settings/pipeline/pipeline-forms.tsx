"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SelectField, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { saveLostReason, saveSource, saveStage, saveTransitions } from "@/modules/pipeline/actions";

type Option = { value: string; label: string };

const COLOURS: Option[] = [
  { value: "new", label: "Blue (new)" },
  { value: "contacted", label: "Teal (contacted)" },
  { value: "qualified", label: "Violet (qualified)" },
  { value: "negotiation", label: "Amber (negotiation)" },
];

export function StageForm({
  stage,
}: {
  stage?: { id: string; name: string; category: "open" | "won" | "lost"; stage: string; requiresOwner: boolean };
}) {
  const [state, action] = useActionState(saveStage, initialState);
  const [category, setCategory] = useState(stage?.category ?? "open");
  const p = stage?.id ?? "new";
  return (
    <form action={action} className="flex flex-col gap-3">
      {stage && <input type="hidden" name="stageId" value={stage.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" name="name" id={`stage-name-${p}`} defaultValue={stage?.name} required maxLength={60} state={state} />
        <SelectField
          label="Type"
          name="category"
          id={`stage-cat-${p}`}
          value={category}
          onChange={(e) => setCategory(e.target.value as typeof category)}
          options={[
            { value: "open", label: "Open (in progress)" },
            { value: "won", label: "Won (converted)" },
            { value: "lost", label: "Lost (asks for a reason)" },
          ]}
          state={state}
        />
        {category === "open" && (
          <SelectField label="Colour" name="colour" id={`stage-colour-${p}`} defaultValue={stage?.category === "open" ? stage.stage : "new"} options={COLOURS} state={state} />
        )}
      </div>
      <label className="flex items-center gap-2 text-[13.5px]">
        <input type="checkbox" name="requiresOwner" defaultChecked={stage?.requiresOwner} />
        Leads need an owner before they can enter this stage
      </label>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant={stage ? "secondary" : "primary"} pendingLabel="Saving…">
          {stage ? "Save stage" : "Add stage"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function TransitionsForm({ stageId, others, allowed }: { stageId: string; others: Option[]; allowed: string[] }) {
  const [state, action] = useActionState(saveTransitions, initialState);
  const [mode, setMode] = useState(allowed.length ? "some" : "any");
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="stageId" value={stageId} />
      <fieldset className="flex flex-col gap-2 text-[13.5px]">
        <legend className="mb-1 text-[13px] font-medium">Leads in this stage can move to</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="any" checked={mode === "any"} onChange={() => setMode("any")} />
          Any stage
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="some" checked={mode === "some"} onChange={() => setMode("some")} />
          Only these stages
        </label>
      </fieldset>
      {mode === "some" && (
        <div className="grid gap-1.5 pl-6 text-[13.5px] sm:grid-cols-2">
          {others.map((o) => (
            <label key={o.value} className="flex items-center gap-2">
              <input type="checkbox" name="allowed" value={o.value} defaultChecked={allowed.includes(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">Save rule</SubmitButton>
      </div>
    </form>
  );
}

export function ReasonForm({ reason }: { reason?: { id: string; name: string } }) {
  const [state, action] = useActionState(saveLostReason, initialState);
  const p = reason?.id ?? "new";
  return (
    <form action={action} className="flex flex-col gap-2">
      {reason && <input type="hidden" name="reasonId" value={reason.id} />}
      <div className="flex items-end gap-2">
        <Field
          label={reason ? "Reason" : "Add a reason"}
          name="name"
          id={`reason-${p}`}
          defaultValue={reason?.name}
          required
          maxLength={80}
          className="flex-1"
          state={state}
        />
        <SubmitButton variant="secondary" pendingLabel="…">{reason ? "Save" : "Add"}</SubmitButton>
      </div>
      {state.message && <FormMessage state={state} />}
    </form>
  );
}

const CHANNELS: Option[] = [
  { value: "meta", label: "Meta (Facebook, Instagram)" },
  { value: "google", label: "Google" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "website", label: "Website" },
  { value: "walk_in", label: "Walk-in" },
  { value: "referral", label: "Referral" },
  { value: "phone", label: "Phone" },
  { value: "other", label: "Other" },
];

export function SourceForm({ source }: { source?: { id: string; name: string; channel: string } }) {
  const [state, action] = useActionState(saveSource, initialState);
  const p = source?.id ?? "new";
  return (
    <form action={action} className="flex flex-col gap-2">
      {source && <input type="hidden" name="sourceId" value={source.id} />}
      <div className="grid gap-2 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <Field label={source ? "Name" : "New source"} name="name" id={`source-${p}`} defaultValue={source?.name} required maxLength={60} state={state} />
        <SelectField label="Channel" name="channel" id={`source-ch-${p}`} defaultValue={source?.channel ?? "other"} options={CHANNELS} state={state} />
        <SubmitButton variant="secondary" pendingLabel="…">{source ? "Save" : "Add"}</SubmitButton>
      </div>
      {state.message && <FormMessage state={state} />}
    </form>
  );
}
