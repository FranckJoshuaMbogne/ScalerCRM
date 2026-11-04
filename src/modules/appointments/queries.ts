import "server-only";
import { createClient } from "@/lib/supabase/server";

export type AppointmentKind = "consultation" | "measurement" | "trial" | "alteration" | "delivery" | "other";
export type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "no_show" | "cancelled";

export type Appointment = {
  id: string;
  kind: AppointmentKind;
  status: AppointmentStatus;
  title: string | null;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  staffId: string | null;
  branchId: string | null;
  leadId: string | null;
  orderId: string | null;
  customer: { id: string; fullName: string; phone: string | null } | null;
};

type Row = {
  id: string;
  kind: AppointmentKind;
  status: AppointmentStatus;
  title: string | null;
  notes: string | null;
  starts_at: string;
  ends_at: string;
  staff_id: string | null;
  branch_id: string | null;
  lead_id: string | null;
  order_id: string | null;
  customer_id: string;
};

const COLUMNS = "id, kind, status, title, notes, starts_at, ends_at, staff_id, branch_id, lead_id, order_id, customer_id";

async function hydrate(rows: Row[]): Promise<Appointment[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, full_name, primary_phone")
    .in("id", [...new Set(rows.map((r) => r.customer_id))]);
  const cust = new Map((data ?? []).map((c) => [c.id, { id: c.id, fullName: c.full_name, phone: c.primary_phone }]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    title: r.title,
    notes: r.notes,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    staffId: r.staff_id,
    branchId: r.branch_id,
    leadId: r.lead_id,
    orderId: r.order_id,
    customer: cust.get(r.customer_id) ?? null,
  }));
}

export async function listAppointments(
  businessId: string,
  from: Date,
  to: Date,
  filters: { branch?: string; staff?: string },
) {
  const supabase = await createClient();
  let query = supabase
    .from("appointments")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at")
    .limit(500);
  if (filters.branch) query = query.eq("branch_id", filters.branch);
  if (filters.staff) query = query.eq("staff_id", filters.staff);
  const { data, error } = await query.returns<Row[]>();
  if (error) throw new Error(`Could not load appointments: ${error.message}`);
  return hydrate(data ?? []);
}

export async function listCustomerAppointments(customerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(COLUMNS)
    .eq("customer_id", customerId)
    .order("starts_at", { ascending: false })
    .limit(30)
    .returns<Row[]>();
  if (error) throw new Error(`Could not load appointments: ${error.message}`);
  return hydrate(data ?? []);
}

export async function listOrderAppointments(orderId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("appointments").select(COLUMNS).eq("order_id", orderId).order("starts_at").returns<Row[]>();
  return hydrate(data ?? []);
}

export type WalkIn = {
  id: string;
  purpose: string | null;
  visitedAt: string;
  staffId: string | null;
  leadId: string | null;
  customer: { id: string; fullName: string } | null;
};

export async function listWalkIns(businessId: string, from: Date, to: Date) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("walk_ins")
    .select("id, purpose, visited_at, staff_id, lead_id, customer_id")
    .eq("business_id", businessId)
    .gte("visited_at", from.toISOString())
    .lt("visited_at", to.toISOString())
    .order("visited_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load walk-ins: ${error.message}`);
  const rows = data ?? [];
  const { data: customers } = rows.length
    ? await supabase.from("customers").select("id, full_name").in("id", [...new Set(rows.map((r) => r.customer_id))])
    : { data: [] };
  const cust = new Map((customers ?? []).map((c) => [c.id, { id: c.id, fullName: c.full_name }]));
  return rows.map(
    (r): WalkIn => ({
      id: r.id,
      purpose: r.purpose,
      visitedAt: r.visited_at,
      staffId: r.staff_id,
      leadId: r.lead_id,
      customer: cust.get(r.customer_id) ?? null,
    }),
  );
}

/** No-shows on one customer file, for the CIF profile. */
export async function countNoShows(customerId: string) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("status", "no_show");
  return count ?? 0;
}
