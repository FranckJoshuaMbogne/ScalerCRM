import { escapeHtml } from "@/modules/email/templates";
import { formatMetric, METRICS, type MetricKey } from "./metrics";

export const REPORT_METRICS: Record<string, MetricKey[]> = {
  executive: ["leads", "conversion_rate", "orders", "revenue", "collected", "outstanding", "walk_ins", "tasks_overdue"],
  marketing: ["leads", "conversion_rate", "spend", "orders", "revenue", "median_first_reply_seconds"],
  sales: ["leads", "leads_won", "conversion_rate", "orders", "average_order_value", "tasks_overdue"],
  operations: ["orders", "appointments", "no_show_rate", "walk_ins", "outstanding"],
};

const TITLE: Record<string, string> = { executive: "Executive summary", marketing: "Marketing", sales: "Sales", operations: "Operations" };

/** Pure: the email for one scheduled report. */
export function reportEmail(input: {
  report: string;
  businessName: string;
  currency: string;
  from: string;
  to: string;
  summary: Record<string, unknown>;
  url: string;
}) {
  const keys = REPORT_METRICS[input.report] ?? REPORT_METRICS.executive;
  const rows = keys
    .filter((k) => input.summary[k] !== null && input.summary[k] !== undefined)
    .map((k) => ({ label: METRICS[k].label, value: formatMetric(input.summary[k], METRICS[k].format, input.currency) }));
  const subject = `${input.businessName}: ${TITLE[input.report] ?? "Report"} for ${input.from} to ${input.to}`;
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f5f2;padding:24px;color:#1b1b1f">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e3dc;border-radius:10px;padding:24px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;font-weight:600">SCALER</p>
<h1 style="margin:0 0 4px;font-size:18px">${escapeHtml(TITLE[input.report] ?? "Report")}</h1>
<p style="margin:0 0 16px;font-size:13px;color:#6b6b73">${escapeHtml(input.businessName)} · ${input.from} to ${input.to}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows
    .map((r) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee;color:#6b6b73">${escapeHtml(r.label)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${escapeHtml(r.value)}</td></tr>`)
    .join("")}</table>
<p style="margin:20px 0 0"><a href="${escapeHtml(input.url)}" style="color:#1d5bd8">Open the dashboard</a></p>
</div></body></html>`;
  const text = [subject, "", ...rows.map((r) => `${r.label}: ${r.value}`), "", input.url].join("\n");
  return { subject, html, text };
}
