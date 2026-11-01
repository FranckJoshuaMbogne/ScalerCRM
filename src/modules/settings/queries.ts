import "server-only";
import { createClient } from "@/lib/supabase/server";

export type BusinessProfile = {
  name: string;
  slug: string;
  legalName: string | null;
  industry: string | null;
  countryCode: string;
  currency: string;
  timezone: string;
};

export async function getBusinessProfile(businessId: string): Promise<BusinessProfile> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("businesses")
    .select("name, slug, legal_name, industry, country_code, currency, timezone")
    .eq("id", businessId)
    .single();
  if (error) throw new Error(`Could not load business: ${error.message}`);
  return {
    name: data.name,
    slug: data.slug,
    legalName: data.legal_name,
    industry: data.industry,
    countryCode: data.country_code,
    currency: data.currency,
    timezone: data.timezone,
  };
}

export type AuditEntry = {
  id: number;
  action: "insert" | "update" | "delete";
  entityType: string;
  entityId: string | null;
  actorName: string;
  changes: Record<string, unknown> | null;
  createdAt: string;
};

export async function listAuditLog(businessId: string, limit = 100): Promise<AuditEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, actor_id, changes, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load audit log: ${error.message}`);

  const actorIds = [...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const { data: people } = await supabase.from("profiles").select("id, full_name, email").in("id", actorIds);
    for (const p of people ?? []) names.set(p.id, p.full_name || p.email || "Unknown");
  }

  return (data ?? []).map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    actorName: r.actor_id ? (names.get(r.actor_id) ?? "Former member") : "System",
    changes: r.changes,
    createdAt: r.created_at,
  }));
}
