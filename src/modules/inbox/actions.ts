"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, friendlyDbError } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { sendQueuedMessage } from "@/modules/integrations/whatsapp/ingest";
import { guard } from "@/modules/tenancy/guard";
import { getContext, requirePermission } from "@/modules/tenancy/session";

const uuid = z.uuid();

export async function sendReply(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await requirePermission("inbox.reply");
    const conversationId = uuid.parse(form.get("conversationId"));
    const body = z.string().trim().min(1, "Write a message.").max(4096, "WhatsApp messages are limited to 4,096 characters.")
      .safeParse(form.get("body"));
    if (!body.success) return { ok: false, message: body.error.issues[0].message };
    const supabase = await createClient();
    // Permission, window and connection checks happen in the database.
    const { data: messageId, error } = await supabase.rpc("queue_whatsapp_reply", {
      p_conversation_id: conversationId,
      p_body: body.data,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: { body: body.data } };
    const sent = await sendQueuedMessage(String(messageId));
    refresh();
    return sent.ok ? { ok: true } : { ok: false, message: `WhatsApp didn't accept the message: ${sent.error}` };
  });
}

export async function addNote(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const ctx = await getContext();
    const conversationId = uuid.parse(form.get("conversationId"));
    const body = z.string().trim().min(1, "Write the note.").max(4000).safeParse(form.get("body"));
    if (!body.success) return { ok: false, message: body.error.issues[0].message };
    const supabase = await createClient();
    const { error } = await supabase.from("messages").insert({
      business_id: ctx.business.businessId,
      conversation_id: conversationId,
      direction: "note",
      type: "note",
      body: body.data,
      status: "note",
      sent_by: ctx.user.id,
    });
    if (error) return { ok: false, message: friendlyDbError(error), values: { body: body.data } };
    refresh();
    return { ok: true };
  });
}

async function updateConversation(form: FormData, row: Record<string, unknown>, message: string): Promise<ActionState> {
  const ctx = await getContext();
  const id = uuid.parse(form.get("conversationId"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .update(row)
    .eq("id", id)
    .eq("business_id", ctx.business.businessId)
    .select("id");
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!data?.length) return { ok: false, message: "You can't change this conversation." };
  refresh();
  return { ok: true, message };
}

export async function assignConversation(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const raw = String(form.get("assigneeId") ?? "");
    const assignee = raw ? uuid.parse(raw) : null;
    return updateConversation(form, { assignee_id: assignee }, assignee ? "Assigned." : "Unassigned.");
  });
}

export async function setConversationStatus(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const status = z.enum(["open", "closed"]).parse(form.get("status"));
    return updateConversation(form, { status }, status === "closed" ? "Conversation closed. A new message reopens it." : "Reopened.");
  });
}

export async function setLabels(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const labels = [
      ...new Set(
        String(form.get("labels") ?? "")
          .split(",")
          .map((l) => l.trim().toLowerCase().slice(0, 30))
          .filter(Boolean),
      ),
    ].slice(0, 20);
    return updateConversation(form, { labels }, "Labels saved.");
  });
}

/** Opening a conversation marks it read. */
export async function markConversationRead(conversationId: string) {
  const ctx = await getContext();
  const supabase = await createClient();
  await supabase
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", uuid.parse(conversationId))
    .eq("business_id", ctx.business.businessId)
    .gt("unread_count", 0);
}
