/**
 * Custom fields engine. Definitions live in `custom_field_definitions`;
 * values are stored as JSON on the record (`customers.custom_fields`,
 * `leads.custom_fields`). This module is pure so forms, the API and tests
 * share one set of rules.
 */

export const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "multiselect", "boolean"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export type FieldEntity = "customer" | "lead" | "order";

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  number: "Number",
  date: "Date",
  select: "Pick one",
  multiselect: "Pick several",
  boolean: "Yes / no",
};

export type FieldDefinition = {
  id: string;
  entity: FieldEntity;
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  required: boolean;
  helpText: string | null;
  position: number;
  isActive: boolean;
};

export type CustomValue = string | number | boolean | string[];
export type CustomValues = Record<string, CustomValue>;

/** Form input name for a custom field, so it can't clash with built-in fields. */
export const inputName = (key: string) => `cf_${key}`;

/** Machine key from a label: lowercase, underscores, starts with a letter, ≤ 40 chars. */
export function fieldKey(label: string): string {
  const base = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 40)
    .replace(/_+$/, "");
  return base || "field";
}

/** Splits an options textarea (one per line or comma-separated) into a clean list. */
export function parseOptions(raw: string): string[] {
  const parts = raw.includes("\n") ? raw.split("\n") : raw.split(",");
  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))].slice(0, 50);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string) {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Reads and validates custom field values from a submitted form.
 * Empty inputs are omitted. Unknown or inactive fields are ignored.
 */
export function readCustomFields(
  definitions: FieldDefinition[],
  form: FormData,
): { values: CustomValues; errors: Record<string, string> } {
  const values: CustomValues = {};
  const errors: Record<string, string> = {};

  for (const def of definitions) {
    if (!def.isActive) continue;
    const name = inputName(def.key);
    const raw = def.type === "multiselect" ? form.getAll(name).map(String) : String(form.get(name) ?? "").trim();
    const result = coerce(def, raw);
    if ("error" in result) errors[name] = result.error;
    else if (result.value !== undefined) values[def.key] = result.value;
  }
  return { values, errors };
}

/** Validates a single value. Used by forms and by JSON input. */
export function coerce(
  def: Pick<FieldDefinition, "type" | "options" | "required" | "label">,
  raw: unknown,
): { value: CustomValue | undefined } | { error: string } {
  const empty =
    raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.filter(Boolean).length === 0);
  if (empty) {
    if (def.type === "boolean") return { value: false };
    return def.required ? { error: `${def.label} is required.` } : { value: undefined };
  }

  switch (def.type) {
    case "text":
    case "textarea": {
      const s = String(raw).trim();
      const max = def.type === "text" ? 200 : 2000;
      return s.length > max ? { error: `Keep ${def.label} under ${max} characters.` } : { value: s };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
      return Number.isFinite(n) ? { value: n } : { error: `${def.label} must be a number.` };
    }
    case "date": {
      const s = String(raw);
      return isValidDate(s) ? { value: s } : { error: `${def.label} must be a date.` };
    }
    case "select": {
      const s = String(raw);
      return def.options.includes(s) ? { value: s } : { error: `Choose a valid ${def.label}.` };
    }
    case "multiselect": {
      const list = (Array.isArray(raw) ? raw : [raw]).map(String).filter(Boolean);
      const bad = list.find((v) => !def.options.includes(v));
      return bad ? { error: `“${bad}” is not an option for ${def.label}.` } : { value: [...new Set(list)] };
    }
    case "boolean": {
      const v = raw === true || raw === "true" || raw === "on" || raw === "1" || raw === "yes";
      return { value: v };
    }
  }
}

/** Human-readable value for display. */
export function formatCustomValue(def: Pick<FieldDefinition, "type">, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (def.type === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (def.type === "date" && typeof value === "string" && DATE.test(value)) {
    return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  }
  return String(value);
}
