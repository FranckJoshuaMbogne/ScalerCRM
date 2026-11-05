import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfigured, sendEmail } from "@/modules/email/send";
import { reportEmail } from "./report-email";
import { type Pack, packEmail, packFiles } from "@/modules/branch-reporting/pack";

/** Sends due scheduled reports (called by the job route). */
export async function runScheduledReports(origin: string) {
  if (!emailConfigured()) return { sent: 0, skipped: true };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_report_schedules", { p_limit: 20 });
  if (error) throw new Error(`claim_report_schedules failed: ${error.message}`);
  let sent = 0;
  for (const s of (data ?? []) as { id: string; email: string; report: string; business_name: string; currency: string; period_from: string; period_to: string; branch_id: string | null }[]) {
    if (s.report.startsWith("pack_")) {
      // Report packs (Sprint 15): the pack as the recipient sees it, tables attached as CSV.
      const { data: packData } = await admin.rpc("report_pack_for", { p_schedule_id: s.id, p_from: s.period_from, p_to: s.period_to });
      if (!packData) continue;
      const pack = packData as Pack;
      const branchName = s.branch_id ? ((pack.branches ?? []).find((b) => b.branch_id === s.branch_id)?.branch_name as string | undefined) : null;
      const query = new URLSearchParams({ kind: s.report, from: s.period_from, to: s.period_to, ...(s.branch_id ? { branch: s.branch_id } : {}) });
      const email = packEmail(pack, { businessName: s.business_name, currency: s.currency, url: `${origin}/analytics/pack?${query}`, branchName });
      const r = await sendEmail(s.email, email, packFiles(pack));
      if (r.ok) sent++;
      else console.error("[reports]", r.error);
      continue;
    }
    const { data: summary } = await admin.rpc("report_summary_for", { p_schedule_id: s.id, p_from: s.period_from, p_to: s.period_to });
    if (!summary) continue;
    const email = reportEmail({
      report: s.report,
      businessName: s.business_name,
      currency: s.currency,
      from: s.period_from,
      to: s.period_to,
      summary: summary as Record<string, unknown>,
      url: `${origin}/analytics?from=${s.period_from}&to=${s.period_to}`,
    });
    const r = await sendEmail(s.email, email);
    if (r.ok) sent++;
    else console.error("[reports]", r.error);
  }
  return { sent };
}
