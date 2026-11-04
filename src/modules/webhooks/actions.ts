"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, fieldErrors, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/modules/tenancy/session";
import { guard } from "@/modules/tenancy/guard";
import { WEBHOOK_EVENT_TYPES } from "./events";
import { checkWebhookUrl } from "./url-guard";

const endpointId = (form: FormData) => z.uuid().parse(form.get("endpointId"));

export async function createWebhookEndpoint(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const parsed = z
      .object({
        url: z.string().trim().min(1, "Enter the URL to send events to.").max(2000),
        description: z.string().trim().max(200).optional(),
        events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1, "Choose at least one event."),
      })
      .safeParse({ url: form.get("url"), description: form.get("description") || undefined, events: form.getAll("events") });
    if (!parsed.success) return fieldErrors(parsed.error, form);
    const problem = checkWebhookUrl(parsed.data.url);
    if (problem) return { ok: false, fieldErrors: { url: problem }, values: { url: parsed.data.url } };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_webhook_endpoint", {
      p_business_id: ctx.business.businessId,
      p_url: parsed.data.url,
      p_events: parsed.data.events,
      p_description: parsed.data.description ?? null,
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    const created = data as { endpoint: { id: string }; secret: string };
    refresh();
    return {
      ok: true,
      message: "Endpoint added. Copy the signing secret now; it won't be shown again.",
      data: { secret: created.secret, id: created.endpoint.id },
    };
  });
}

async function update(form: FormData, input: Record<string, unknown>, message: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_webhook_endpoint", {
      p_business_id: ctx.business.businessId,
      p_id: endpointId(form),
      p_input: input,
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message };
  });
}

export async function setWebhookActive(_: ActionState, form: FormData): Promise<ActionState> {
  const on = form.get("active") === "true";
  return update(form, { is_active: on }, on ? "Endpoint on. New events will be sent." : "Endpoint off. Nothing more is sent to it.");
}

export async function saveWebhookEvents(_: ActionState, form: FormData): Promise<ActionState> {
  const events = form.getAll("events").map(String).filter((e) => (WEBHOOK_EVENT_TYPES as readonly string[]).includes(e));
  if (!events.length) return { ok: false, message: "Choose at least one event." };
  return update(form, { events }, "Events saved.");
}

export async function rotateWebhookSecret(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rotate_webhook_secret", {
      p_business_id: ctx.business.businessId,
      p_id: endpointId(form),
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "New secret made. Requests are signed with it from now on.", data: { secret: data as string } };
  });
}

export async function sendWebhookTest(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("send_webhook_test", { p_business_id: ctx.business.businessId, p_id: endpointId(form) });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Test event queued. It goes out with the next background run (within 5 minutes)." };
  });
}

export async function replayDelivery(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const id = z.coerce.number().int().positive().parse(form.get("deliveryId"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("replay_webhook_delivery", { p_business_id: ctx.business.businessId, p_delivery_id: id });
    if (error) return { ok: false, message: friendlyDbError(error) };
    refresh();
    return { ok: true, message: "Queued again." };
  });
}

export async function deleteWebhookEndpoint(_: ActionState, form: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requirePermission("integrations.manage");
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_webhook_endpoint", { p_business_id: ctx.business.businessId, p_id: endpointId(form) });
    if (error) return { ok: false, message: friendlyDbError(error) };
    return { ok: true };
  });
  if (result.ok) redirect("/settings/webhooks");
  return result;
}
