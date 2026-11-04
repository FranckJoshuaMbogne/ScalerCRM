import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PlatformBilling = {
  seller: {
    legal_name: string | null;
    gstin: string | null;
    state_code: string | null;
    address: string | null;
    email: string | null;
    invoice_prefix: string;
    sac_code: string;
    gst_rate: number;
  };
  sellerReady: boolean;
  byStatus: Record<string, number>;
  failedEvents: { id: number; provider: string; event_type: string; error: string; received_at: string; business_id: string | null }[];
  longReadOnly: { business_id: string; name: string; since: string }[];
  unreconciled: { provider: string; payment_id: string; business_id: string | null; paid: number | null; invoiced: number | null; problem: string }[];
};

export async function getPlatformBilling(): Promise<PlatformBilling> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_billing");
  if (error) throw new Error(`Could not load billing: ${error.message}`);
  const d = data as Record<string, unknown>;
  return {
    seller: d.seller as PlatformBilling["seller"],
    sellerReady: Boolean(d.seller_ready),
    byStatus: (d.by_status as Record<string, number>) ?? {},
    failedEvents: (d.failed_events as PlatformBilling["failedEvents"]) ?? [],
    longReadOnly: (d.long_read_only as PlatformBilling["longReadOnly"]) ?? [],
    unreconciled: (d.unreconciled as PlatformBilling["unreconciled"]) ?? [],
  };
}

export type BusinessBilling = {
  subscription: Record<string, unknown> | null;
  history: { from_status: string | null; to_status: string; reason: string; created_at: string }[];
  invoices: { id: string; number: string; total: number; issued_at: string; test_mode: boolean }[];
  events: { id: number; event_type: string; result: string | null; error: string | null; received_at: string }[];
};

export async function getBusinessBilling(businessId: string): Promise<BusinessBilling> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_business_billing", { p_business_id: businessId });
  if (error) throw new Error(`Could not load billing: ${error.message}`);
  return data as BusinessBilling;
}
