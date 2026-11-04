"use client";

import { startTransition, useActionState, useState } from "react";
import { FormMessage, SelectField } from "@/components/ui/form";
import { Button } from "@/components/ui/primitives";
import { type ImportState, runImport } from "@/modules/imports/actions";
import { FIELDS, type ImportKind } from "@/modules/imports/fields";
import { templateCsv } from "@/modules/imports/templates";

const KIND_OPTIONS = [
  { value: "customers", label: "Customers" },
  { value: "leads", label: "Leads" },
  { value: "orders", label: "Orders" },
];

export function ImportForm() {
  const [state, action, pending] = useActionState(runImport, {} as ImportState);
  const [kind, setKind] = useState<ImportKind>("customers");
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv(kind))}`;
  const checked = state.stage === "checked" && state.ok && (state.ready ?? 0) > 0 && state.kind === kind;

  // Submitted by hand so the chosen file stays selected between "Check" and "Import".
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(e.currentTarget);
    data.set("mode", submitter?.value ?? "check");
    startTransition(() => action(data));
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <SelectField
          label="The file contains"
          name="kind"
          options={KIND_OPTIONS}
          value={kind}
          onChange={(e) => setKind(e.target.value as ImportKind)}
          className="w-48"
        />
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">CSV file</span>
          <input type="file" name="file" accept=".csv,text/csv" required className="block text-[13.5px]" />
        </label>
        <a href={template} download={`scaler-${kind}-template.csv`} className="pb-2 text-[13.5px] text-signal hover:underline">
          Download the {kind} template
        </a>
      </div>
      <p className="text-[13px] text-muted">
        Columns it understands: {FIELDS[kind].map((f) => f.label).join(", ")}. Every row needs a phone number or an email.
        Phones are matched to existing customer files, so importing twice doesn&apos;t create duplicates.
      </p>

      <div className="flex gap-3">
        <Button type="submit" value="check" disabled={pending}>
          {pending ? "Working…" : "Check file"}
        </Button>
        {checked && (
          <Button type="submit" value="import" variant="secondary" disabled={pending}>
            Import {state.ready?.toLocaleString("en-IN")} rows
          </Button>
        )}
      </div>
      {pending && <p className="text-[13px] text-muted">Large files take a few minutes. Keep this page open.</p>}

      {state.message && <FormMessage state={state} />}

      {state.total !== undefined && (
        <div className="rounded-lg border border-line p-4 text-[13.5px]">
          <p className="font-medium">
            {state.fileName}: {state.total.toLocaleString("en-IN")} rows, {(state.ready ?? 0).toLocaleString("en-IN")} without problems
          </p>
          {state.result && (
            <p className="mt-1">
              {state.result.created} new · {state.result.matched} matched existing customers · {state.result.skipped} already
              imported · {state.result.failed} refused
            </p>
          )}
          {state.columns && <p className="mt-2 text-muted">Columns read: {state.columns.join(" · ")}</p>}
          {state.ignored?.length ? <p className="mt-1 text-muted">Ignored columns: {state.ignored.join(", ")}</p> : null}
          {state.problems?.length ? (
            <ul className="mt-3 max-h-72 space-y-1 overflow-auto">
              {state.problems.map((p) => (
                <li key={`${p.row}-${p.error}`}>
                  <span className="font-medium">Row {p.row}</span> (line {p.row + 1}): {p.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </form>
  );
}
