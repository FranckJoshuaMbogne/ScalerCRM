"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getContext } from "@/modules/tenancy/session";
import { listNotifications, type Notification } from "./queries";

/** Latest notifications for the bell, loaded when it opens. */
export async function loadNotifications(): Promise<{ unread: number; items: Notification[] }> {
  const ctx = await getContext();
  return listNotifications(ctx.business.businessId);
}

/** Marks one notification read, or all of them when no id is given. */
export async function markNotificationsRead(id?: number): Promise<void> {
  const ctx = await getContext();
  const supabase = await createClient();
  let query = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("business_id", ctx.business.businessId)
    .is("read_at", null);
  if (id !== undefined) query = query.eq("id", z.number().int().positive().parse(id));
  await query;
}
