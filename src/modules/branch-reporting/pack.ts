/**
 * Report packs: the pack JSON (private.report_pack) as CSV files and an email.
 * Pure, so the same code serves the scheduled email, the CSV download and tests.
 */
import { toCsv } from "@/lib/csv";
import { escapeHtml, layout, type RenderedEmail } from "@/modules/email/layout";
import { TARGET_METRICS, type TargetMetric } from "./targets";

export const PACKS = {
  pack_owner: { label: "Owner pack", description: "Every branch side by side, targets, salespeople, sources, campaigns and transfers." },
  pack_branch: { label: "Branch manager pack", description: "One branch: its figures, targets, team and transfers." },
  pack_marketing: { label: "Marketing pack", description: "Leads and conversion by source and campaign." },
} as const;
export type PackKind = keyof typeof PACKS;

type Row = Record<string, unknown>;
export type Pack = {
  kind: PackKind;
  from: string;
  to: string;
  summary: Row | null;
  branches?: Row[];
  targets?: Row[];
  transfers?: Row[];
  team?: Row[];
  sources?: Row[];
  campaigns?: Row[];
};

const col = (header: string, key: string) => ({ header, value: (r: Row) => r[key] });

const SECTIONS: { key: keyof Pack; file: string; title: string; columns: { header: string; value: (r: Row) => unknown }[] }[] = [
  {
    key: "branches",
    file: "branches",
    title: "Branches",
    columns: [
      col("Branch", "branch_name"), col("Leads", "leads"), col("Won", "won"), col("Conversion %", "conversion_rate"),
      col("Expected won", "expected_won"), col("Performance index", "performance_index"), col("Days to win", "median_days_to_win"),
      col("Orders", "orders"), col("Revenue", "revenue"), col("Average order", "average_order_value"), col("Collected", "collected"),
      col("Outstanding", "outstanding"), col("Walk-ins", "walk_ins"), col("Appointments", "appointments"),
      col("No-show %", "no_show_rate"), col("Overdue tasks", "tasks_overdue"),
    ],
  },
  {
    key: "targets",
    file: "targets",
    title: "Targets",
    columns: [
      { header: "For", value: (r) => r.person_name ?? r.branch_name ?? "Business" },
      { header: "Measure", value: (r) => TARGET_METRICS[r.metric as TargetMetric]?.label ?? r.metric },
      col("Period start", "period_start"), col("Period end", "period_end"), col("Target", "target"), col("Actual", "actual"),
      col("% of target", "percent"), col("% of period gone", "expected_percent"),
    ],
  },
  {
    key: "team",
    file: "salespeople",
    title: "Salespeople",
    columns: [
      col("Salesperson", "owner_name"), col("Leads", "leads"), col("Won", "won"), col("Conversion %", "conversion_rate"),
      col("Expected won", "expected_won"), col("Performance index", "performance_index"), col("Overdue tasks", "open_overdue_tasks"),
      col("Days to win", "median_days_to_win"),
    ],
  },
  {
    key: "transfers",
    file: "transfers",
    title: "Lead transfers",
    columns: [
      col("From", "from_branch"), col("To", "to_branch"), col("Transfers", "transfers"), col("Won after transfer", "won"),
      col("Median days to close", "median_days_to_close"), col("Sent by", "senders"), col("Closed by", "closers"),
    ],
  },
  {
    key: "sources",
    file: "sources",
    title: "Sources",
    columns: [col("Source", "label"), col("Leads", "leads"), col("Won", "won"), col("Conversion %", "conversion_rate"), col("Orders", "orders"), col("Order value", "revenue")],
  },
  {
    key: "campaigns",
    file: "campaigns",
    title: "Campaigns",
    columns: [col("Campaign", "label"), col("Leads", "leads"), col("Won", "won"), col("Conversion %", "conversion_rate"), col("Spend", "spend"), col("Order value", "revenue")],
  },
];

const SUMMARY_FIELDS: [string, string][] = [
  ["leads", "Leads"], ["leads_won", "Converted"], ["conversion_rate", "Conversion %"], ["orders", "Orders"],
  ["revenue", "Revenue"], ["collected", "Collected"], ["outstanding", "Outstanding"], ["walk_ins", "Walk-ins"],
  ["appointments", "Appointments"], ["no_show_rate", "No-show %"], ["tasks_overdue", "Overdue tasks"],
];

/** The pack's sections that have rows, as CSV files named for the period. */
export function packFiles(pack: Pack): { filename: string; content: string }[] {
  const suffix = `${pack.from}_to_${pack.to}.csv`;
  const files: { filename: string; content: string }[] = [];
  if (pack.summary) {
    const rows = SUMMARY_FIELDS.filter(([k]) => pack.summary![k] !== null && pack.summary![k] !== undefined).map(([k, label]) => ({ label, value: pack.summary![k] }));
    files.push({ filename: `summary_${suffix}`, content: toCsv(rows, [{ header: "Measure", value: (r) => r.label }, { header: "Value", value: (r) => r.value }]) });
  }
  for (const s of SECTIONS) {
    const rows = pack[s.key] as Row[] | undefined;
    if (rows?.length) files.push({ filename: `${s.file}_${suffix}`, content: toCsv(rows, s.columns) });
  }
  return files;
}

export function packSectionCsv(pack: Pack, section: string): string | null {
  if (section === "summary") return packFiles(pack).find((f) => f.filename.startsWith("summary_"))?.content ?? null;
  const s = SECTIONS.find((x) => x.file === section);
  const rows = s ? (pack[s.key] as Row[] | undefined) : undefined;
  return s && rows ? toCsv(rows, s.columns) : null;
}

export function packSections(pack: Pack) {
  return SECTIONS.filter((s) => ((pack[s.key] as Row[] | undefined)?.length ?? 0) > 0).map((s) => ({
    file: s.file,
    title: s.title,
    columns: s.columns.map((c) => c.header),
    rows: (pack[s.key] as Row[]).map((r) => s.columns.map((c) => c.value(r))),
  }));
}

function money(v: unknown, currency: string) {
  const n = Number(v);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(n) : "—";
}

/** The pack email: headline figures, branch lines and targets; the full tables are attached as CSV. */
export function packEmail(pack: Pack, opts: { businessName: string; currency: string; url: string; branchName?: string | null }): RenderedEmail {
  const kind = PACKS[pack.kind];
  const s = pack.summary ?? {};
  const head = [
    `${opts.branchName ? `${opts.branchName}: ` : ""}${pack.from} to ${pack.to}.`,
    `Leads ${s.leads ?? 0}, converted ${s.leads_won ?? 0} (${s.conversion_rate ?? "—"}%), orders ${s.orders ?? 0}` +
      (s.revenue !== null && s.revenue !== undefined ? `, revenue ${money(s.revenue, opts.currency)}, collected ${money(s.collected, opts.currency)}.` : "."),
  ];
  const branchLines = (pack.branches ?? []).map(
    (b) => `${b.branch_name}: ${b.leads} leads, ${b.won} converted (index ${b.performance_index ?? "—"})` + (b.revenue !== null && b.revenue !== undefined ? `, ${money(b.revenue, opts.currency)} revenue` : ""),
  );
  const targetLines = (pack.targets ?? []).map(
    (t) => `${t.person_name ?? t.branch_name ?? "Business"} · ${TARGET_METRICS[t.metric as TargetMetric]?.label ?? t.metric}: ${t.percent}% of target (${t.expected_percent}% of the period gone)`,
  );
  const lines = [...head, ...(branchLines.length ? ["Branches:", ...branchLines] : []), ...(targetLines.length ? ["Targets:", ...targetLines] : []), "The full tables are attached as CSV files."];
  const footer = `You get this ${kind.label.toLowerCase()} because you scheduled it in Reports for ${opts.businessName}.`;
  return {
    subject: `${kind.label}: ${opts.businessName}${opts.branchName ? ` · ${opts.branchName}` : ""}, ${pack.from} to ${pack.to}`,
    html: layout(escapeHtml(kind.label), lines.map(escapeHtml), { label: "Open the pack (printable)", url: opts.url }, escapeHtml(footer)),
    text: [...lines, "", `Open the pack: ${opts.url}`, "", footer].join("\n"),
  };
}
