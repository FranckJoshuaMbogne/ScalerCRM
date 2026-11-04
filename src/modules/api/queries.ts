import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export async function listApiKeys(businessId: string): Promise<ApiKey[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, prefix, last_used_at, revoked_at, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load API keys: ${error.message}`);
  return (data ?? []).map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    lastUsedAt: k.last_used_at,
    revokedAt: k.revoked_at,
    createdAt: k.created_at,
  }));
}
