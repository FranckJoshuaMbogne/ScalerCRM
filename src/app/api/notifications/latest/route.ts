import { createClient } from "@/lib/supabase/server";

/**
 * What a push notification shows. Pushes carry no content; the service worker
 * asks here with the signed-in session, so nothing personal passes through the
 * browser vendor's push service.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return Response.json({ error: "signed_out" }, { status: 401 });
  const { data } = await supabase
    .from("notifications")
    .select("id, title, body, link")
    .eq("user_id", claims.claims.sub)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Response.json(data ?? {}, { headers: { "cache-control": "private, no-store" } });
}
