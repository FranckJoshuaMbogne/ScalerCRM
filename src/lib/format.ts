/** Money as stored (numeric string) → localised currency, without float maths on the value. */
export function formatMoney(value: string | number | null | undefined, currency: string) {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

export function formatDateTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
}

export function formatDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone }).format(new Date(iso));
}

/** "+919849012345" → "+91 98490 12345"-ish grouping for display only. */
export function formatPhone(e164: string | null | undefined) {
  if (!e164) return "—";
  const m = e164.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

export function formatBytes(n: number | null) {
  if (n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
