import { parseCsv } from "@/lib/csv";
import { rupeesToPaise } from "./money";

/**
 * Matches a provider settlement report against SCALER's invoices.
 * Accepts Razorpay's settlement reconciliation CSV (entity_id, type, amount in rupees)
 * or any CSV with payment_id and amount columns.
 */

export type SettlementRow = { paymentId: string; amount: string };
export type InvoiceMatch = { paymentId: string; number: string; total: string | number };
export type Mismatch = { paymentId: string; settled: string | null; invoiced: string | null; problem: string };

export function parseSettlementCsv(text: string): { rows: SettlementRow[]; error?: string } {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const idCol = header.findIndex((h) => h === "entity_id" || h === "payment_id");
  const amountCol = header.indexOf("amount");
  const typeCol = header.indexOf("type");
  if (idCol < 0 || amountCol < 0) return { rows: [], error: "The file needs entity_id (or payment_id) and amount columns." };
  const rows: SettlementRow[] = [];
  for (const line of table.slice(1)) {
    const id = line[idCol]?.trim();
    if (!id) continue;
    if (typeCol >= 0 && line[typeCol]?.trim() && line[typeCol]!.trim().toLowerCase() !== "payment") continue;
    rows.push({ paymentId: id, amount: (line[amountCol] ?? "").replace(/,/g, "").trim() });
  }
  return { rows };
}

export function reconcile(settled: SettlementRow[], invoices: InvoiceMatch[]) {
  const byPayment = new Map(invoices.map((i) => [i.paymentId, i]));
  const mismatches: Mismatch[] = [];
  let matched = 0;
  for (const row of settled) {
    const invoice = byPayment.get(row.paymentId);
    let settledPaise: number;
    try {
      settledPaise = rupeesToPaise(row.amount);
    } catch {
      mismatches.push({ paymentId: row.paymentId, settled: row.amount, invoiced: null, problem: "amount isn't readable" });
      continue;
    }
    if (!invoice) mismatches.push({ paymentId: row.paymentId, settled: row.amount, invoiced: null, problem: "no invoice for this payment" });
    else if (rupeesToPaise(invoice.total) !== settledPaise)
      mismatches.push({ paymentId: row.paymentId, settled: row.amount, invoiced: String(invoice.total), problem: "amounts differ" });
    else matched++;
  }
  return { matched, mismatches };
}
