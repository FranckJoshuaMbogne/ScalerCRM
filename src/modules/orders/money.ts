/**
 * Exact money maths for order lines, mirroring the generated columns in SQL:
 *   gross = round(qty × price, 2); tax = round((gross − discount) × rate / 100, 2);
 *   total = gross − discount + tax. Rounding is half away from zero, like Postgres numeric.
 * Amounts are handled as integer paise (BigInt), never floats.
 */

const ZERO = BigInt(0);
const TEN = BigInt(10);

/** "1250.5" → 125050n (scale 2). Quantities use scale 3, rates scale 2. Null if not a plain decimal. */
export function toScaled(value: string | number | null | undefined, scale: number): bigint | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().replace(/,/g, "");
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[3] ?? "";
  if (frac.length > scale) return null;
  const n = BigInt(m[2]) * TEN ** BigInt(scale) + BigInt(frac.padEnd(scale, "0") || "0");
  return m[1] ? -n : n;
}

/** Divide and round half away from zero. */
function divRound(n: bigint, d: bigint) {
  const neg = n < ZERO !== d < ZERO;
  const a = n < ZERO ? -n : n;
  const b = d < ZERO ? -d : d;
  const q = (a + b / BigInt(2)) / b;
  return neg ? -q : q;
}

export function fromPaise(paise: bigint) {
  const neg = paise < ZERO;
  const a = neg ? -paise : paise;
  return `${neg ? "-" : ""}${a / BigInt(100)}.${(a % BigInt(100)).toString().padStart(2, "0")}`;
}

export type LineInput = { quantity: string; unitPrice: string; discount?: string; taxRate?: string };
export type LineAmounts = { gross: bigint; discount: bigint; tax: bigint; total: bigint };

export function lineAmounts(line: LineInput): LineAmounts | null {
  const qty = toScaled(line.quantity || "1", 3);
  const price = toScaled(line.unitPrice || "0", 2);
  const discount = toScaled(line.discount || "0", 2);
  const rate = toScaled(line.taxRate || "0", 2);
  if (qty === null || price === null || discount === null || rate === null) return null;
  // qty (×1000) × price (×100) → ×100000; back to paise.
  const gross = divRound(qty * price, BigInt(1000));
  const net = gross - discount;
  const tax = divRound(net * rate, BigInt(10000));
  return { gross, discount, tax, total: net + tax };
}

export function documentTotals(lines: LineInput[]) {
  let subtotal = ZERO;
  let discount = ZERO;
  let tax = ZERO;
  let total = ZERO;
  for (const l of lines) {
    const a = lineAmounts(l);
    if (!a) continue;
    subtotal += a.gross;
    discount += a.discount;
    tax += a.tax;
    total += a.total;
  }
  return { subtotal: fromPaise(subtotal), discount: fromPaise(discount), tax: fromPaise(tax), total: fromPaise(total) };
}

export type PaymentState = "unpaid" | "partial" | "paid" | "overpaid";

/** From numeric strings as returned by PostgREST. */
export function paymentState(total: string, netPaid: string): PaymentState {
  const t = toScaled(total, 2) ?? ZERO;
  const p = toScaled(netPaid, 2) ?? ZERO;
  if (p <= ZERO) return t === ZERO ? "paid" : "unpaid";
  if (p < t) return "partial";
  return p === t ? "paid" : "overpaid";
}
