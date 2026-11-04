"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, echo, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { guard } from "@/modules/tenancy/guard";
import { can, requirePermission } from "@/modules/tenancy/session";
import { parseLocalInput, resolvePreset } from "./schedule";

const TYPES = ["follow_up", "call", "whatsapp", "visit", "meeting", "email", "other"] as const;

const DEFAULT_TITLES: Record<(typeof TYPES)[number], string> = {
  follow_up: "Follow up",
  call: "Call back",
  whatsapp: "WhatsApp follow-up",
  visit: "Store visit",
  meeting: "Meeting",
  email: "Send email",
  other: "To do",
};

const optionalId = z
  .union([z.uuid(), z.literal("")])
  .nullish()
  .transform((v) => v || null);

const createSchema = z.object({
  leadId: optionalId,
  customerId: optionalId,
  type: z.enum(TYPES).default("follow_up"),
  title: z.string().trim().max(200, "Keep it under 200 characters.").optional(),
  notes: z.string().trim().max(4000).optional(),
  assigneeId: optionalId,
  when: z.string().optional(),
  dueAt: z.string().optional(),
});

/** Preset button ("tomorrow") or a datetime-local value, read in the business zone. */
function readDue(when: string | undefined, dueAt: string | undefined, timeZone: string) {
  if (when && when !== "custom") return resolvePreset(when, new Date(), timeZone);
  return dueAt ? parseLocalInput(dueAt, timeZone) : null;
}

export async function createTask(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("tasks.manage");
    const parsed = createSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, message: "Check the task details.", values: echo(form) };
    const d = parsed.data;
    const due = readDue(d.when, d.dueAt, ctx.business.timezone);
    if (!due) {
      return { ok: false, message: "Pick when it's due.", fieldErrors: { dueAt: "Pick a date and time." }, values: echo(form) };
    }
    const assignee = d.assigneeId && can(ctx, "tasks.view_all") ? d.assigneeId : ctx.user.id;

    const supabase = await createClient();
    const { error } = await supabase.from("tasks").insert({
      business_id: ctx.business.businessId,
      lead_id: d.leadId,
      customer_id: d.leadId ? null : d.customerId,
      type: d.type,
      title: d.title || DEFAULT_TITLES[d.type],
      notes: d.notes || null,
      due_at: due.toISOString(),
      assignee_id: assignee,
      created_by: ctx.user.id,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: echo(form) };
    refresh();
    return { ok: true, message: assignee === ctx.user.id ? "Follow-up set." : "Task assigned. They've been notified." };
  });
}

const uuid = z.uuid();

async function updateTask(form: FormData, row: Record<string, unknown>, message: string): Promise<ActionState> {
  const ctx = await requirePermission("tasks.manage");
  const id = uuid.parse(form.get("taskId"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update(row)
    .eq("id", id)
    .eq("business_id", ctx.business.businessId)
    .select("id");
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!data?.length) return { ok: false, message: "You can't change this task." };
  refresh();
  return { ok: true, message };
}

export async function completeTask(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const outcome = z.string().trim().max(2000).optional().parse(form.get("outcome") ?? undefined);
    return updateTask(form, { completed_at: new Date().toISOString(), outcome: outcome || null }, "Done.");
  });
}

export async function reopenTask(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => updateTask(form, { completed_at: null, cancelled_at: null }, "Task reopened."));
}

export async function cancelTask(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => updateTask(form, { cancelled_at: new Date().toISOString() }, "Task cancelled."));
}

export async function rescheduleTask(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("tasks.manage");
    const due = readDue(
      form.get("when")?.toString(),
      form.get("dueAt")?.toString(),
      ctx.business.timezone,
    );
    if (!due) return { ok: false, message: "Pick a new date and time." };
    return updateTask(form, { due_at: due.toISOString() }, "Rescheduled.");
  });
}

export async function reassignTask(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await requirePermission("tasks.view_all");
    const assignee = uuid.safeParse(form.get("assigneeId"));
    if (!assignee.success) return { ok: false, message: "Choose who should do it." };
    return updateTask(form, { assignee_id: assignee.data }, "Task reassigned. They've been notified.");
  });
}
