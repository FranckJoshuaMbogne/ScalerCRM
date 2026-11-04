/**
 * CSV for spreadsheets. Values are quoted when needed, and text that a
 * spreadsheet would run as a formula (=, +, -, @ at the start) is prefixed
 * with an apostrophe so an exported customer name can't execute.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: { header: string; value: (row: T) => unknown }[]) {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r))).join(","));
  // BOM so Excel opens UTF-8 (₹, names in Indian scripts) correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}
