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
};

export type LeadSource = { id: string; key: string; name: string; channel: string; isActive: boolean };

export const listStatuses = cache(async (businessId: string): Promise<LeadStatus[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_statuses")
    .select("id, key, name, category, stage, position, is_default, is_active")
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
