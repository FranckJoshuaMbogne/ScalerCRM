"use server";

import type { CountryCode } from "libphonenumber-js";
import { refresh } from "next/cache";
import { parseCsv } from "@/lib/csv";
import { friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { PermissionError, requirePermission } from "@/modules/tenancy/session";
import { FIELDS, IMPORT_KINDS, type ImportKind } from "./fields";
import { buildRows, type RowProblem } from "./rows";
import { getImportLookups } from "./queries";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 50_000;
const BATCH = 250;

export type ImportState = {
  ok?: boolean;
  message?: string;
  /** "checked": nothing written yet; "imported": the job ran. */
  stage?: "checked" | "imported";
  kind?: ImportKind;
  fileName?: string;
  total?: number;
  ready?: number;
  columns?: string[];
  ignored?: string[];
  problems?: RowProblem[];
  result?: { created: number; matched: number; skipped: number; failed: number };
};

/**
 * Checks a CSV (mode=check) or imports it (mode=import). The file is parsed and
 * validated the same way both times; only rows without problems are sent, in
 * batches of 250, each row in its own savepoint on the database side.
 */
export async function runImport(_: ImportState, form: FormData): Promise<ImportState> {
  let ctx;
  try {
    ctx = await requirePermission("data.import");
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, message: e.message };
    throw e;
  }
  const kind = String(form.get("kind") ?? "") as ImportKind;
  const file = form.get("file");
  if (!IMPORT_KINDS.includes(kind)) return { ok: false, message: "Choose what the file contains." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file." };
  if (file.size > MAX_BYTES) return { ok: false, message: "Files can be up to 10 MB. Split larger files." };

  const records = parseCsv(await file.text());
  if (records.length < 2) return { ok: false, message: "The file has no rows under its header." };
  if (records.length - 1 > MAX_ROWS) return { ok: false, message: `Files can have up to ${MAX_ROWS.toLocaleString("en-IN")} rows. Split larger files.` };

  const biz = ctx.business.businessId;
  const lookups = await getImportLookups(biz);
  const { rows, problems, columns, missing } = buildRows(kind, records, lookups, ctx.business.countryCode as CountryCode);
  if (missing.length) {
    return { ok: false, message: `The file needs a column for ${missing.join(" and ")}. Download the template to see the headings.` };
  }
  const header = records[0];
  const used = new Set(Object.values(columns));
  const summary: ImportState = {
    kind,
    fileName: file.name.slice(0, 200),
    total: records.length - 1,
    ready: rows.length,
    columns: FIELDS[kind].filter((f) => columns[f.key] !== undefined).map((f) => `${f.label} ← “${header[columns[f.key]]}”`),
    ignored: header.filter((h, i) => !used.has(i) && h.trim()),
    problems: problems.slice(0, 200),
  };

  if (form.get("mode") !== "import") {
    return { ...summary, ok: true, stage: "checked", message: rows.length ? undefined : "No row can be imported. Fix the problems below and check again." };
  }
  if (!rows.length) return { ...summary, ok: false, stage: "checked", message: "No row can be imported." };

  const supabase = await createClient();
  const { data: jobId, error: startError } = await supabase.rpc("start_import", {
    p_business_id: biz,
    p_kind: kind,
    p_file_name: summary.fileName!,
    p_total_rows: summary.total!,
  });
  if (startError) return { ...summary, ok: false, message: friendlyDbError(startError) };

  const result = { created: 0, matched: 0, skipped: 0, failed: 0 };
  const failures: RowProblem[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const { data, error } = await supabase.rpc("import_rows", { p_job_id: jobId, p_rows: rows.slice(i, i + BATCH) });
    if (error) {
      await supabase.rpc("finish_import", { p_job_id: jobId });
      refresh();
      return { ...summary, ok: false, stage: "imported", result, message: `Stopped after ${i} rows: ${friendlyDbError(error)} The rows before that were imported.` };
    }
    const r = data as typeof result & { errors: RowProblem[] };
    result.created += r.created;
    result.matched += r.matched;
    result.skipped += r.skipped;
    result.failed += r.failed;
    failures.push(...r.errors);
  }
  await supabase.rpc("finish_import", { p_job_id: jobId });
  refresh();
  return {
    ...summary,
    ok: true,
    stage: "imported",
    result,
    problems: [...problems, ...failures].sort((a, b) => a.row - b.row).slice(0, 200),
    message: `Imported ${summary.fileName}.`,
  };
}
