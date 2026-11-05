/** Targets (ADR 0016). Pure: labels, period maths and pace. */

export const TARGET_METRICS = {
  leads_handled: { label: "Leads handled", money: false, definition: "Leads created in the period, owned by the person or in the branch." },
  conversions: { label: "Conversions", money: false, definition: "Leads moved to a won stage during the period." },
  revenue: { label: "Revenue", money: true, definition: "Value of orders created in the period, not cancelled." },
  collections: { label: "Collections", money: true, definition: "Payments received in the period, less refunds." },
} as const;
export type TargetMetric = keyof typeof TARGET_METRICS;

export type TargetPeriod = "month" | "quarter";

/** First day of the month or quarter containing `date` (YYYY-MM-DD). */
export function periodStart(date: string, type: TargetPeriod): string {
  const [y, m] = date.split("-").map(Number);
  const month = type === "month" ? m : Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(month).padStart(2, "0")}-01`;
}

/** Last day of the period that starts on `start`. */
export function periodEnd(start: string, type: TargetPeriod): string {
  const [y, m] = start.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1 + (type === "month" ? 1 : 3), 0));
  return end.toISOString().slice(0, 10);
}

export function periodLabel(start: string, type: TargetPeriod): string {
  const [y, m] = start.split("-").map(Number);
  if (type === "quarter") {
    // Indian financial year quarters: Apr–Jun is Q1.
    const q = ((Math.floor((m - 1) / 3) + 3) % 4) + 1;
    const fy = m >= 4 ? y : y - 1;
    return `Q${q} FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;
  }
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "ahead", "on track" or "behind": progress compared with how much of the period has gone. */
export function pace(percent: number | null, expectedPercent: number | null): "ahead" | "on_track" | "behind" | null {
  if (percent === null || expectedPercent === null) return null;
  if (percent >= 100 || percent >= expectedPercent + 10) return "ahead";
  if (percent >= expectedPercent - 10) return "on_track";
  return "behind";
}
