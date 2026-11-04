"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SelectField, SubmitButton, TextAreaField } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { saveFieldDefinition } from "@/modules/custom-fields/actions";
import { FIELD_TYPE_LABELS, FIELD_TYPES, type FieldDefinition, type FieldEntity, type FieldType } from "@/modules/custom-fields/engine";

export function FieldDefinitionForm({ entity, field }: { entity: FieldEntity; field?: FieldDefinition }) {
  const [state, action] = useActionState(saveFieldDefinition, initialState);
  const [type, setType] = useState<FieldType>(field?.type ?? "text");
  const p = field?.id ?? `new-${entity}`;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="fieldId" value={field?.id ?? ""} />
      <input type="hidden" name="entity" value={entity} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Label" name="label" id={`${p}-label`} defaultValue={field?.label} required placeholder="Garment type" state={state} />
        <SelectField
          label="Type"
          name="type"
          id={`${p}-type`}
          value={type}
          onChange={(e) => setType(e.target.value as FieldType)}
          disabled={Boolean(field)}
          options={FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_LABELS[t] }))}
          state={state}
        />
        {field && <input type="hidden" name="type" value={type} />}
        {(type === "select" || type === "multiselect") && (
          <TextAreaField label="Options" name="options" id={`${p}-options`} hint="One per line." className="sm:col-span-2"
            defaultValue={field?.options.join("\n")} state={state} />
        )}
        <Field label="Help text" name="helpText" id={`${p}-help`} defaultValue={field?.helpText ?? ""} className="sm:col-span-2" state={state} />
        <label className="flex items-center gap-2 text-[13.5px]">
          <input type="checkbox" name="required" defaultChecked={field?.required} />
          Required
        </label>
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant={field ? "secondary" : "primary"} pendingLabel="Saving…">
          {field ? "Save field" : "Add field"}
        </SubmitButton>
      </div>
    </form>
  );
}
