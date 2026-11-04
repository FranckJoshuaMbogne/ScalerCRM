"use server";

import type { CountryCode } from "libphonenumber-js";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, echo, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { normalisePhone } from "@/modules/crm/phone";
import { parseLocalInput } from "@/modules/tasks/schedule";
import { guard } from "@/modules/tenancy/guard";
import { requirePermission } from "@/modules/tenancy/session";

const optionalId = z
  .union([z.uuid(), z.literal("")])
  .nullish()
  .transform((v) => v || null);

const KINDS = ["consultation", "measurement", "trial", "alteration", "delivery", "other"] as const;

const bookSchema = z.object({
  customerId: z.uuid("Choose a customer."),
  leadId: optionalId,
  orderId: optionalId,
  branchId: optionalId,
  staffId: optionalId,
  kind: z.enum(KINDS),
  startsAt: z.string().min(1, "Pick a date and time."),
  duration: z.coerce.number().int().min(10).max(480).default(30),
  title: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function bookAppointment(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("appointments.manage");
    const parsed = bookSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message, values: echo(form) };
    const d = parsed.data;
    const start = parseLocalInput(d.startsAt, ctx.business.timezone);
    if (!start) return { ok: false, message: "Pick a valid date and time.", fieldErrors: { startsAt: "Pick a valid date and time." }, values: echo(form) };
    const end = new Date(start.getTime() + d.duration * 60_000);

    const supabase = await createClient();
    const { error } = await supabase.from("appointments").insert({
      business_id: ctx.business.businessId,
      customer_id: d.customerId,
      lead_id: d.leadId,
      order_id: d.orderId,
      branch_id: d.branchId,
      staff_id: d.staffId ?? ctx.user.id,
      kind: d.kind,
      title: d.title || null,
      notes: d.notes || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      created_by: ctx.user.id,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    refresh();
    return { ok: true, message: "Appointment booked." };
  });
}

const STATUS = ["scheduled", "confirmed", "completed", "no_show", "cancelled"] as const;

export async function setAppointmentStatus(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("appointments.manage");
    const id = z.uuid().parse(form.get("appointmentId"));
    const status = z.enum(STATUS).parse(form.get("status"));
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("appointments")
      .update({ status })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "You can't change this appointment." };
    refresh();
    const labels: Record<(typeof STATUS)[number], string> = {
      scheduled: "Back to scheduled.",
      confirmed: "Confirmed.",
      completed: "Marked as completed.",
      no_show: "Marked as a no-show.",
      cancelled: "Appointment cancelled.",
    };
    return { ok: true, message: labels[status] };
  });
}

export async function rescheduleAppointment(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("appointments.manage");
    const id = z.uuid().parse(form.get("appointmentId"));
    const start = parseLocalInput(String(form.get("startsAt") ?? ""), ctx.business.timezone);
    const duration = z.coerce.number().int().min(10).max(480).catch(30).parse(form.get("duration"));
    if (!start) return { ok: false, message: "Pick a valid date and time." };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("appointments")
      .update({
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + duration * 60_000).toISOString(),
        status: "scheduled",
      })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId)
      .select("id");
    if (error) return { ok: false, message: friendlyDbError(error) };
    if (!data?.length) return { ok: false, message: "You can't change this appointment." };
    refresh();
    return { ok: true, message: "Rescheduled." };
  });
}

const walkInSchema = z.object({
  customerId: optionalId,
  phone: z.string().trim().max(40).optional(),
  fullName: z.string().trim().max(160).optional(),
  email: z.union([z.email("Enter a valid email address.").trim().toLowerCase(), z.literal("")]).optional(),
  branchId: optionalId,
  staffId: optionalId,
  purpose: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function registerWalkIn(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("appointments.manage");
    const parsed = walkInSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message, values: echo(form) };
    const d = parsed.data;
    const invalid = (field: string, message: string): ActionState => ({
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: { [field]: message },
      values: echo(form),
    });
    const phone = d.phone ? normalisePhone(d.phone, ctx.business.countryCode as CountryCode) : null;
    if (!d.customerId) {
      if (d.phone && !phone) return invalid("phone", "That doesn't look like a valid phone number.");
      if (!phone && !d.email) return invalid("phone", "Enter a phone number or an email.");
      if (!d.fullName) return invalid("fullName", "Enter the customer's name.");
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("register_walk_in", {
      p_business_id: ctx.business.businessId,
      p_input: d.customerId
        ? { customer_id: d.customerId, branch_id: d.branchId, staff_id: d.staffId, purpose: d.purpose, notes: d.notes }
        : {
            phone,
            email: d.email || null,
            full_name: d.fullName,
            branch_id: d.branchId,
            staff_id: d.staffId,
            purpose: d.purpose,
            notes: d.notes,
          },
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    const r = data as { lead_id: string; lead_created: boolean; customer_created: boolean; appointment_id: string | null };
    const params = new URLSearchParams({ walkin: "1" });
    if (r.customer_created) params.set("new", "1");
    else if (!r.lead_created) params.set("existing", "1");
    if (r.appointment_id) params.set("arrived", "1");
    redirect(`/leads/${r.lead_id}?${params}`);
  });
}
