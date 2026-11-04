import { Field, SelectField, TextAreaField } from "@/components/ui/form";
import type { ActionState } from "@/lib/forms";
import { type CustomValues, type FieldDefinition, inputName } from "@/modules/custom-fields/engine";

/** Inputs for a business's custom fields. Values post as `cf_<key>`. */
export function CustomFieldInputs({
  definitions,
  values = {},
  state,
  idPrefix = "cf",
}: {
  definitions: FieldDefinition[];
  values?: CustomValues;
  state?: ActionState;
  idPrefix?: string;
}) {
  if (!definitions.length) return null;
  return (
    <>
      {definitions.map((def) => {
        const name = inputName(def.key);
        const id = `${idPrefix}-${def.key}`;
        const label = def.required ? `${def.label} *` : def.label;
        const value = values[def.key];
        const error = state?.fieldErrors?.[name];
        const hint = def.helpText ?? undefined;
        switch (def.type) {
          case "textarea":
            return (
              <TextAreaField key={def.key} id={id} label={label} name={name} hint={hint} state={state}
                defaultValue={typeof value === "string" ? value : ""} className="sm:col-span-2" />
            );
          case "select":
            return (
              <SelectField key={def.key} id={id} label={label} name={name} state={state}
                defaultValue={typeof value === "string" ? value : ""}
                options={[{ value: "", label: "—" }, ...def.options.map((o) => ({ value: o, label: o }))]} />
            );
          case "multiselect": {
            const selected = Array.isArray(value) ? value : [];
            return (
              <fieldset key={def.key} className="flex flex-col gap-1.5 sm:col-span-2">
                <legend className="mb-1.5 text-[13px] font-medium">{label}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {def.options.map((o) => (
                    <label key={o} className="flex items-center gap-2 text-[13.5px]">
                      <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} />
                      {o}
                    </label>
                  ))}
                </div>
                {(error || hint) && <p className={error ? "text-[12.5px] text-danger" : "text-[12.5px] text-muted"}>{error ?? hint}</p>}
              </fieldset>
            );
          }
          case "boolean":
            return (
              <label key={def.key} htmlFor={id} className="flex items-center gap-2 self-end pb-2.5 text-[14px]">
                <input id={id} type="checkbox" name={name} defaultChecked={value === true} />
                {def.label}
              </label>
            );
          default:
            return (
              <Field key={def.key} id={id} label={label} name={name} hint={hint} state={state}
                type={def.type === "number" ? "number" : def.type === "date" ? "date" : "text"}
                step={def.type === "number" ? "any" : undefined}
                defaultValue={value === undefined ? "" : String(value)} />
            );
        }
      })}
    </>
  );
}
