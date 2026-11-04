import { connection } from "next/server";
import { createAnonClient } from "@/lib/supabase/anon";

/**
 * For uptime monitors: 200 when the database answers and background jobs
 * succeeded in the last 15 minutes, 503 otherwise. Shows no error details.
 */
export async function GET() {
  await connection(); // always live, never prerendered
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("health");
  if (error) return Response.json({ database: "down" }, { status: 503, headers: { "cache-control": "no-store" } });
  const h = data as { database: string; jobs_ok: boolean; jobs_last_ok_at: string | null };
  return Response.json(
    { database: h.database, jobs: h.jobs_ok ? "ok" : "stale", jobs_last_ok_at: h.jobs_last_ok_at },
    { status: h.jobs_ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
