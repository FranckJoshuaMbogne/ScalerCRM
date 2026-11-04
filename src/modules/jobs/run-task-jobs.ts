import "server-only";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfigured, sendEmail } from "@/modules/email/send";
import { renderOutboxEmail } from "@/modules/email/templates";
import { runCampaigns } from "@/modules/campaigns/worker";
import { runAdSync } from "@/modules/integrations/ads/sync";
import { runAutomations } from "@/modules/automation/worker";
import { runScheduledReports } from "@/modules/analytics/reports";
import { retryPendingEvents } from "@/modules/integrations/whatsapp/ingest";
import { runPushes } from "@/modules/push/send";
import { reportError } from "@/lib/monitoring";

/** True when the request carries `Authorization: Bearer $CRON_SECRET`. */
export function authorisedCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

type Claimed = { id: number; to_email: string; template: string; payload: Record<string, unknown> };

/**
 * One pass of the background work: overdue notifications, reminder queueing,
 * then sending queued email. Safe to run often and concurrently.
 */
export async function runTaskJobs(origin: string) {
  const admin = createAdminClient();
  try {
    const result = await runAll(admin, origin);
    // Sub-jobs that failed on their own report { error }; the heartbeat records the first one.
    const failed = Object.entries(result).find(([, v]) => v && typeof v === "object" && "error" in v);
    const error = failed ? `${failed[0]}: ${String((failed[1] as { error: unknown }).error)}` : null;
    if (error) await reportError(new Error(error), { job: "task_jobs" });
    await admin.rpc("record_job_heartbeat", { p_name: "task_jobs", p_error: error, p_details: result });
    return result;
  } catch (e) {
    await reportError(e, { job: "task_jobs" });
    await admin.rpc("record_job_heartbeat", {
      p_name: "task_jobs",
      p_error: e instanceof Error ? e.message : String(e),
      p_details: null,
    });
    throw e;
  }
}

async function runAll(admin: ReturnType<typeof createAdminClient>, origin: string) {
  const { data: jobs, error } = await admin.rpc("run_task_jobs");
  if (error) throw new Error(`run_task_jobs failed: ${error.message}`);
  const webhookRetries = await retryPendingEvents(admin);
  const campaigns = await runCampaigns();
  const ads = await runAdSync().catch((e) => ({ error: e instanceof Error ? e.message : "ad sync failed" }));
  const automations = await runAutomations().catch((e) => ({ error: e instanceof Error ? e.message : "automation failed" }));
  const reports = await runScheduledReports(origin).catch((e) => ({ error: e instanceof Error ? e.message : "reports failed" }));
  const push = await runPushes().catch((e) => ({ error: e instanceof Error ? e.message : "push failed" }));
  const { data: housekeeping } = await admin.rpc("housekeeping");
  // Usage snapshot once a day (the first run after 18:30 UTC, midnight IST); safe to repeat.
  const now = new Date();
  const usageSnapshot =
    now.getUTCHours() === 18 && now.getUTCMinutes() >= 30 && now.getUTCMinutes() < 35
      ? (await admin.rpc("snapshot_usage")).data
      : null;

  // Without email configured, queued reminders wait (and expire after a day).
  const mail = { sent: 0, failed: 0, skipped: !emailConfigured() };
  if (!mail.skipped) {
    for (let batch = 0; batch < 5; batch++) {
      const { data, error: claimError } = await admin.rpc("claim_emails", { p_limit: 20 });
      if (claimError) throw new Error(`claim_emails failed: ${claimError.message}`);
      const rows = (data ?? []) as Claimed[];
      if (!rows.length) break;
      for (const row of rows) {
        const email = renderOutboxEmail(row.template, row.payload ?? {}, origin);
        const result = email
          ? await sendEmail(row.to_email, email)
          : { ok: false as const, error: `unknown template ${row.template}` };
        await admin.rpc("finish_email", { p_id: row.id, p_error: result.ok ? null : result.error });
        if (result.ok) mail.sent++;
        else mail.failed++;
      }
    }
  }
  return { jobs, mail, webhookRetries, campaigns, ads, automations, reports, push, housekeeping, usageSnapshot };
}
