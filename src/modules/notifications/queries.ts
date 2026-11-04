import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Notification = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export async function listNotifications(businessId: string, limit = 20) {
  const supabase = await createClient();
  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .is("read_at", null),
  ]);
  if (error) throw new Error(`Could not load notifications: ${error.message}`);
  return {
    unread: count ?? 0,
    items: (data ?? []).map(
      (n): Notification => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.read_at,
        createdAt: n.created_at,
      }),
    ),
  };
}

export async function countUnreadNotifications(businessId: string) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .is("read_at", null);
  return count ?? 0;
}
