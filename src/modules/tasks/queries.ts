import "server-only";
import { createClient } from "@/lib/supabase/server";
import { startOfDay } from "./schedule";

export type TaskType = "follow_up" | "call" | "whatsapp" | "visit" | "meeting" | "email" | "other";

export type Task = {
  id: string;
  type: TaskType;
  title: string;
  notes: string | null;
  dueAt: string;
  assigneeId: string | null;
  createdBy: string | null;
  completedAt: string | null;
  completedBy: string | null;
  outcome: string | null;
  cancelledAt: string | null;
  leadId: string | null;
  customerId: string | null;
  lead: { id: string; leadNumber: string; title: string | null } | null;
  customer: { id: string; fullName: string; phone: string | null } | null;
};

const COLUMNS =
  "id, type, title, notes, due_at, assignee_id, created_by, completed_at, completed_by, outcome, cancelled_at, lead_id, customer_id";

type Row = {
  id: string;
  type: TaskType;
  title: string;
  notes: string | null;
  due_at: string;
  assignee_id: string | null;
  created_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  outcome: string | null;
  cancelled_at: string | null;
  lead_id: string | null;
  customer_id: string | null;
};

async function hydrate(rows: Row[]): Promise<Task[]> {
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))] as string[];
  const customerIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))] as string[];
  const supabase = await createClient();
  const [{ data: leads }, { data: customers }] = await Promise.all([
    leadIds.length
      ? supabase.from("leads").select("id, lead_number, title").in("id", leadIds)
      : Promise.resolve({ data: [] as { id: string; lead_number: string; title: string | null }[] }),
    customerIds.length
      ? supabase.from("customers").select("id, full_name, primary_phone").in("id", customerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; primary_phone: string | null }[] }),
  ]);
  const leadMap = new Map((leads ?? []).map((l) => [l.id, { id: l.id, leadNumber: l.lead_number, title: l.title }]));
  const customerMap = new Map(
    (customers ?? []).map((c) => [c.id, { id: c.id, fullName: c.full_name, phone: c.primary_phone }]),
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    notes: r.notes,
    dueAt: r.due_at,
    assigneeId: r.assignee_id,
    createdBy: r.created_by,
    completedAt: r.completed_at,
    completedBy: r.completed_by,
    outcome: r.outcome,
    cancelledAt: r.cancelled_at,
    leadId: r.lead_id,
    customerId: r.customer_id,
    // A lead or customer the viewer can't see stays hidden.
    lead: r.lead_id ? (leadMap.get(r.lead_id) ?? null) : null,
    customer: r.customer_id ? (customerMap.get(r.customer_id) ?? null) : null,
  }));
}

export type MyDayFilter = { who: "me" | "team" | string; userId: string };

/**
 * Open tasks due before the end of the next 7 local days, plus what was done today.
 * "team" means everyone the viewer may see (RLS decides).
 */
export async function listMyDay(businessId: string, filter: MyDayFilter, timeZone: string, now = new Date()) {
  const supabase = await createClient();
  const horizon = startOfDay(now, timeZone, 8).toISOString();
  const today = startOfDay(now, timeZone).toISOString();

  let open = supabase
    .from("tasks")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .is("completed_at", null)
    .is("cancelled_at", null)
    .lt("due_at", horizon)
    .order("due_at")
    .limit(300);
  let done = supabase
    .from("tasks")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .gte("completed_at", today)
    .order("completed_at", { ascending: false })
    .limit(50);
  if (filter.who !== "team") {
    const who = filter.who === "me" ? filter.userId : filter.who;
    open = open.eq("assignee_id", who);
    done = done.eq("assignee_id", who);
  }

  const [{ data: openRows, error }, { data: doneRows, error: doneError }] = await Promise.all([
    open.returns<Row[]>(),
    done.returns<Row[]>(),
  ]);
  if (error) throw new Error(`Could not load tasks: ${error.message}`);
  if (doneError) throw new Error(`Could not load tasks: ${doneError.message}`);
  const [openTasks, doneTasks] = await Promise.all([hydrate(openRows ?? []), hydrate(doneRows ?? [])]);
  return { open: openTasks, done: doneTasks };
}

/** Counts for the dashboard and navigation: my overdue and due-today tasks. */
export async function countMyTasks(businessId: string, userId: string, timeZone: string, now = new Date()) {
  const supabase = await createClient();
  const base = () =>
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("assignee_id", userId)
      .is("completed_at", null)
      .is("cancelled_at", null);
  const [overdue, today] = await Promise.all([
    base().lt("due_at", now.toISOString()),
    base().gte("due_at", now.toISOString()).lt("due_at", startOfDay(now, timeZone, 1).toISOString()),
  ]);
  return { overdue: overdue.count ?? 0, today: today.count ?? 0 };
}

/** Every task on one lead: open first by due date, then the closed ones. */
export async function listLeadTasks(leadId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(COLUMNS)
    .eq("lead_id", leadId)
    .order("due_at")
    .limit(100)
    .returns<Row[]>();
  if (error) throw new Error(`Could not load tasks: ${error.message}`);
  const tasks = await hydrate(data ?? []);
  const open = tasks.filter((t) => !t.completedAt && !t.cancelledAt);
  const closed = tasks.filter((t) => t.completedAt || t.cancelledAt);
  return { open, closed };
}
