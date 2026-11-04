import { siteOrigin } from "@/lib/origin";
import { authorisedCron, runTaskJobs } from "@/modules/jobs/run-task-jobs";

/**
 * Background pass for tasks: overdue alerts, follow-up reminders, email sending.
 * Call every 5 minutes with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends this header automatically). See docs/adr/0004.
 */
// Campaign batches can take a while to send.
export const maxDuration = 300;

async function handle(request: Request) {
  if (!authorisedCron(request)) {
    return Response.json({ error: "unauthorised" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  try {
    const result = await runTaskJobs(await siteOrigin());
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[cron/tasks]", e);
    return Response.json({ error: "job failed" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}

export const GET = handle;
export const POST = handle;
