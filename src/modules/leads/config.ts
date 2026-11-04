import "server-only";
import { cache } from "react";
import type { Stage } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";

export type LeadStatus = {
  id: string;
  key: string;
  name: string;
  category: "open" | "won" | "lost";
  stage: Stage;
  position: number;
  isDefault: boolean;
  isActive: boolean;
  requiresOwner: boolean;
};

export type LeadSource = { id: string; key: string; name: string; channel: string; isActive: boolean };

export const listStatuses = cache(async (businessId: string): Promise<LeadStatus[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_statuses")
    .select("id, key, name, category, stage, position, is_default, is_active, requires_owner")
    .eq("business_id", businessId)
    .order("position");
  if (error) throw new Error(`Could not load lead statuses: ${error.message}`);
  return (data ?? []).map((s) => ({
    id: s.id,
    key: s.key,
    name: s.name,
    category: s.category,
    stage: s.stage,
    position: s.position,
    isDefault: s.is_default,
    isActive: s.is_active,
    requiresOwner: s.requires_owner,
  }));
});

export const listSources = cache(async (businessId: string): Promise<LeadSource[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_sources")
    .select("id, key, name, channel, is_active")
    .eq("business_id", businessId)
    .order("position");
  if (error) throw new Error(`Could not load lead sources: ${error.message}`);
  return (data ?? []).map((s) => ({ id: s.id, key: s.key, name: s.name, channel: s.channel, isActive: s.is_active }));
});

export type LostReason = { id: string; name: string; position: number; isActive: boolean };

export const listLostReasons = cache(async (businessId: string): Promise<LostReason[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_lost_reasons")
    .select("id, name, position, is_active")
    .eq("business_id", businessId)
    .order("position")
    .order("created_at");
  if (error) throw new Error(`Could not load lost reasons: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, position: r.position, isActive: r.is_active }));
});

/** Allowed next stages per stage. A stage missing from the map can move anywhere. */
export const listTransitions = cache(async (businessId: string): Promise<Record<string, string[]>> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_status_transitions")
    .select("from_status_id, to_status_id")
    .eq("business_id", businessId);
  if (error) throw new Error(`Could not load stage rules: ${error.message}`);
  const out: Record<string, string[]> = {};
  for (const t of data ?? []) (out[t.from_status_id] ??= []).push(t.to_status_id);
  return out;
});
