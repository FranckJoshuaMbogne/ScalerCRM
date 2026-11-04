/** Reporting periods as "YYYY-MM-DD" day ranges (inclusive), in the business's time zone. Pure. */

export type Period = { from: string; to: string; label: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function shift(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000) + 1;
}

export const PRESETS = ["7d", "30d", "90d", "month", "last_month"] as const;

/** today is the business-local date ("YYYY-MM-DD"). */
export function resolvePeriod(input: { preset?: string; from?: string; to?: string }, today: string): Period {
  if (input.from && input.to && DATE.test(input.from) && DATE.test(input.to) && input.from <= input.to) {
    return { from: input.from, to: input.to, label: `${input.from} to ${input.to}` };
  }
  switch (input.preset) {
    case "7d":
      return { from: shift(today, -6), to: today, label: "Last 7 days" };
    case "90d":
      return { from: shift(today, -89), to: today, label: "Last 90 days" };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today, label: "This month" };
    case "last_month": {
      const end = shift(`${today.slice(0, 8)}01`, -1);
      return { from: `${end.slice(0, 8)}01`, to: end, label: "Last month" };
    }
    default:
      return { from: shift(today, -29), to: today, label: "Last 30 days" };
  }
}

/** The same number of days immediately before. */
export function previousPeriod(p: Period): Period {
  const n = daysBetween(p.from, p.to);
  return { from: shift(p.from, -n), to: shift(p.from, -1), label: "Previous period" };
}
