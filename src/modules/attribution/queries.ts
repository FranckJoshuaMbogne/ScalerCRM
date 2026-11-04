import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Touchpoint = {
  id: number;
  kind: "first" | "repeat";
  sourceId: string | null;
  campaign: string | null;
  campaignId: string | null;
  adId: string | null;
  gclid: string | null;
  fbclid: string | null;
  utmSource: string | null;
  occurredAt: string;
  leadId: string;
};

/** A customer's touchpoints up to a moment (an order's creation), oldest first. */
export async function listTouchpoints(customerId: string, before?: string) {
  const supabase = await createClient();
  let q = supabase
    .from("lead_touchpoints")
    .select("id, kind, source_id, campaign, campaign_id, ad_id, gclid, fbclid, utm_source, occurred_at, lead_id")
    .eq("customer_id", customerId)
    .order("occurred_at")
    .limit(50);
  if (before) q = q.lte("occurred_at", before);
  const { data } = await q;
  return (data ?? []).map(
    (t): Touchpoint => ({
      id: t.id,
      kind: t.kind,
      sourceId: t.source_id,
      campaign: t.campaign,
      campaignId: t.campaign_id,
      adId: t.ad_id,
      gclid: t.gclid,
      fbclid: t.fbclid,
      utmSource: t.utm_source,
      occurredAt: t.occurred_at,
      leadId: t.lead_id,
    }),
  );
}
