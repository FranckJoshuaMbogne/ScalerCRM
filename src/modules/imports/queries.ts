import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listBranches, listMembers } from "@/modules/team/queries";
import type { ImportKind, Lookups } from "./fields";

/** Names a CSV may use for branches, sources, stages, reasons and people, with their ids. */
export async function getImportLookups(businessId: string): Promise<Lookups> {
  const supabase = await createClient();
  const [branches, members, sources, leadStages, reasons, orderStages] = await Promise.all([
    listBranches(businessId),
    listMembers(businessId),
    supabase.from("lead_sources").select("id, key, name").eq("business_id", businessId),
    supabase.from("lead_statuses").select("id, key, name, category").eq("business_id", businessId).eq("is_active", true),
    supabase.from("lead_lost_reasons").select("id, name").eq("business_id", businessId),
    supabase.from("order_stages").select("id, key, name").eq("business_id", businessId).eq("is_active", true),
  ]);
  for (const r of [sources, leadStages, reasons, orderStages]) {
    if (r.error) throw new Error(`Could not load import lookups: ${r.error.message}`);
  }
  return {
    branches: branches.map((b) => ({ id: b.id, name: b.name })),
    members: members.filter((m) => m.status === "active").map((m) => ({ id: m.userId, name: m.name, email: m.email })),
    sources: sources.data ?? [],
    leadStages: leadStages.data ?? [],
    lostReasons: reasons.data ?? [],
    orderStages: orderStages.data ?? [],
  };
}

export type ImportJob = {
  id: string;
  kind: ImportKind;
  fileName: string;
  status: "running" | "done";
  totalRows: number;
  created: number;
  matched: number;
  skipped: number;
  failed: number;
  errors: { row: number; error: string }[];
  createdAt: string;
  by: string | null;
};

export async function listImportJobs(businessId: string): Promise<ImportJob[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("import_jobs")
    .select("id, kind, file_name, status, total_rows, created_count, matched_count, skipped_count, failed_count, errors, created_at, by:profiles!import_jobs_created_by_fkey(full_name)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`Could not load imports: ${error.message}`);
  type Row = {
    id: string; kind: ImportKind; file_name: string; status: "running" | "done"; total_rows: number;
    created_count: number; matched_count: number; skipped_count: number; failed_count: number;
    errors: { row: number; error: string }[]; created_at: string; by: { full_name: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    fileName: r.file_name,
    status: r.status,
    totalRows: r.total_rows,
    created: r.created_count,
    matched: r.matched_count,
    skipped: r.skipped_count,
    failed: r.failed_count,
    errors: r.errors,
    createdAt: r.created_at,
    by: r.by?.full_name ?? null,
  }));
}
