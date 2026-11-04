import type { CountryCode } from "libphonenumber-js";
import { normalisePhone } from "@/modules/crm/phone";
import { detectColumns, type ImportKind, type Lookups, parseAmount, parseDate, parseGender, parsePaymentMethod, REQUIRED } from "./fields";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const byName = <T extends { name: string; key?: string }>(list: T[], raw: string) => {
  const s = squash(raw);
  return list.find((x) => squash(x.name) === s || (x.key && squash(x.key) === s));
};

export type ImportRow = Record<string, unknown> & { row: number };
export type RowProblem = { row: number; error: string };

/**
 * Turns parsed CSV records (header first) into import rows. Rows with problems
 * are left out and listed, so nothing half-valid reaches the database.
 */
export function buildRows(
  kind: ImportKind,
  records: string[][],
  lookups: Lookups,
  country: CountryCode,
): { rows: ImportRow[]; problems: RowProblem[]; columns: Record<string, number>; missing: string[] } {
  const [header = [], ...data] = records;
  const columns = detectColumns(kind, header);
  const missing = REQUIRED[kind].filter((k) => columns[k] === undefined);
  if (columns.phone === undefined && columns.email === undefined) missing.push("phone or email");
  const rows: ImportRow[] = [];
  const problems: RowProblem[] = [];
  if (missing.length) return { rows, problems, columns, missing };

  data.forEach((cells, i) => {
    const row = i + 1;
    const get = (key: string) => (columns[key] === undefined ? "" : (cells[columns[key]] ?? "").trim());
    const errors: string[] = [];
    const out: ImportRow = { row };

    const rawPhone = get("phone");
    const phone = normalisePhone(rawPhone, country);
    if (rawPhone && !phone) errors.push(`phone "${rawPhone}" isn't a valid number`);
    const email = get("email").toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`email "${email}" isn't valid`);
    if (!phone && !email && !errors.length) errors.push("needs a phone number or an email");
    Object.assign(out, { phone, email: email || null, full_name: get("full_name").slice(0, 160) || null });

    const branch = get("branch");
    if (branch) {
      const b = byName(lookups.branches, branch);
      if (b) out.branch_id = b.id;
      else errors.push(`unknown branch "${branch}"`);
    }

    const date = (key: string, label: string) => {
      const v = parseDate(get(key));
      if (v === null) errors.push(`${label} "${get(key)}" isn't a date (use DD/MM/YYYY or YYYY-MM-DD)`);
      else if (v) out[key] = v;
    };
    const amount = (key: string, label: string) => {
      const v = parseAmount(get(key));
      if (v === null) errors.push(`${label} "${get(key)}" isn't an amount`);
      else if (v) out[key] = v;
    };
    const owner = () => {
      const o = get("owner");
      if (!o) return;
      const m = lookups.members.find((x) => x.email.toLowerCase() === o.toLowerCase()) ?? byName(lookups.members, o);
      if (m) out.owner_id = m.id;
      else errors.push(`"${o}" isn't a member of the team`);
    };

    if (kind === "customers") {
      const g = parseGender(get("gender"));
      if (g === null) errors.push(`gender "${get("gender")}" isn't female, male or other`);
      else if (g) out.gender = g;
      date("date_of_birth", "date of birth");
      if (typeof out.date_of_birth === "string") out.date_of_birth = out.date_of_birth.slice(0, 10);
      date("created_at", "customer since");
      out.tags = get("tags").split(/[;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 20);
    }

    if (kind === "leads") {
      out.external_ref = get("external_ref").slice(0, 80) || null;
      const src = get("source");
      if (src) {
        const s = byName(lookups.sources, src);
        if (s) out.source_id = s.id;
        else errors.push(`unknown source "${src}"`);
      }
      const st = get("stage");
      if (st) {
        const s = byName(lookups.leadStages, st);
        if (s) out.status_id = s.id;
        else errors.push(`unknown stage "${st}"`);
      }
      const lr = get("lost_reason");
      if (lr) {
        const r = byName(lookups.lostReasons, lr);
        if (r) out.lost_reason_id = r.id;
        else errors.push(`unknown lost reason "${lr}"`);
      }
      owner();
      out.title = get("title").slice(0, 160) || null;
      out.campaign = get("campaign").slice(0, 200) || null;
      amount("expected_value", "expected value");
      date("created_at", "enquiry date");
      date("closed_at", "closed date");
    }

    if (kind === "orders") {
      out.external_ref = get("external_ref").slice(0, 80) || null;
      owner();
      out.description = get("description").slice(0, 300) || null;
      amount("total", "total");
      if (out.total === undefined && !errors.some((e) => e.startsWith("total"))) errors.push("total is missing");
      amount("paid", "paid");
      if (out.total && out.paid && Number(out.paid) > Number(out.total)) errors.push("paid is more than the total");
      out.payment_method = parsePaymentMethod(get("payment_method"));
      const st = get("stage");
      if (st) {
        const s = byName(lookups.orderStages, st);
        if (s) out.stage_id = s.id;
        else errors.push(`unknown stage "${st}"`);
      }
      date("created_at", "order date");
      date("due_date", "due date");
      if (typeof out.due_date === "string") out.due_date = out.due_date.slice(0, 10);
      date("closed_at", "delivered date");
      out.notes = get("notes").slice(0, 4000) || null;
    }

    if (errors.length) problems.push({ row, error: errors.join("; ") });
    else rows.push(out);
  });

  return { rows, problems, columns, missing };
}
