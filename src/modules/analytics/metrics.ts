/**
 * One written definition per metric. Every screen (dashboard, analytics,
 * scheduled emails, exports) labels numbers from this list, and the SQL in
 * analytics_summary / analytics_breakdown implements exactly these rules.
 */
export type MetricKey =
  | "leads"
  | "leads_won"
  | "leads_lost"
  | "conversion_rate"
  | "walk_ins"
  | "appointments"
  | "no_show_rate"
  | "orders"
  | "revenue"
  | "average_order_value"
  | "collected"
  | "outstanding"
  | "spend"
  | "median_first_reply_seconds"
  | "tasks_overdue";

export type MetricFormat = "count" | "percent" | "money" | "duration";

export const METRICS: Record<MetricKey, { label: string; format: MetricFormat; definition: string }> = {
  leads: { label: "New leads", format: "count", definition: "Leads created in the period, from every channel. Repeat enquiries on an open lead are not new leads." },
  leads_won: { label: "Converted", format: "count", definition: "Leads created in the period that are in a won stage today." },
  leads_lost: { label: "Lost", format: "count", definition: "Leads created in the period that are in a lost stage today." },
  conversion_rate: { label: "Conversion", format: "percent", definition: "Converted ÷ new leads, for leads created in the period (a cohort, not leads won in the period)." },
  walk_ins: { label: "Walk-ins", format: "count", definition: "Store visits registered in the period, new and returning customers." },
  appointments: { label: "Appointments", format: "count", definition: "Appointments scheduled to start in the period, excluding cancelled ones." },
  no_show_rate: { label: "No-show rate", format: "percent", definition: "No-shows ÷ (attended + no-shows) for appointments in the period." },
  orders: { label: "Orders", format: "count", definition: "Orders created in the period that are not cancelled." },
  revenue: { label: "Order value", format: "money", definition: "Total of orders created in the period that are not cancelled, including tax." },
  average_order_value: { label: "Average order", format: "money", definition: "Order value ÷ orders." },
  collected: { label: "Collected", format: "money", definition: "Payments received in the period, less refunds, whatever the order date." },
  outstanding: { label: "Outstanding", format: "money", definition: "Balance still due on open orders, today." },
  spend: { label: "Ad spend", format: "money", definition: "Spend synced from Meta and Google for days in the period." },
  median_first_reply_seconds: { label: "First reply", format: "duration", definition: "Median time to answer a waiting WhatsApp customer, for replies sent in the period." },
  tasks_overdue: { label: "Overdue follow-ups", format: "count", definition: "Open tasks past their due time, today." },
};

export function formatMetric(value: unknown, format: MetricFormat, currency: string) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  switch (format) {
    case "percent":
      return `${n.toFixed(1)}%`;
    case "money":
      return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
    case "duration": {
      if (n < 60) return `${Math.round(n)}s`;
      const m = Math.round(n / 60);
      return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
    }
    default:
      return new Intl.NumberFormat("en-IN").format(n);
  }
}

/** Change against the previous period, as a signed percentage, or null when not meaningful. */
export function change(current: unknown, previous: unknown): number | null {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return Math.round(((c - p) / Math.abs(p)) * 1000) / 10;
}
