/**
 * Money crosses the provider boundary as integer paise and is stored as numeric(14,2).
 * These conversions use integer and string arithmetic only, never floats.
 */

const RUPEES = /^(\d{1,12})(?:\.(\d{1,2}))?$/;

/** "2948.82" → 294882. Throws on anything that isn't a plain non-negative amount. */
export function rupeesToPaise(amount: string | number): number {
  const text = String(amount).trim();
  const m = RUPEES.exec(text);
  if (!m) throw new Error(`not an amount: ${text}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** 294882 → "2948.82". */
export function paiseToRupees(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error(`not a paise amount: ${paise}`);
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

/** Equal to the paisa, whatever the formatting ("2948.8" = "2948.80"). */
export function sameAmount(a: string | number, b: string | number) {
  return rupeesToPaise(a) === rupeesToPaise(b);
}
