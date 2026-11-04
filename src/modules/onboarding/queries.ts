import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OnboardingStatus, StepKey } from "./steps";

export async function getOnboarding(businessId: string): Promise<OnboardingStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("onboarding_status", { p_business_id: businessId });
  if (error) throw new Error(`Could not load setup progress: ${error.message}`);
  const d = data as Record<string, unknown>;
  return {
    steps: d.steps as Record<StepKey, boolean>,
    skipped: (d.skipped as OnboardingStatus["skipped"]) ?? {},
    templateKey: (d.template_key as string | null) ?? null,
    completedAt: (d.completed_at as string | null) ?? null,
    dismissedAt: (d.dismissed_at as string | null) ?? null,
    isDemo: Boolean(d.is_demo),
  };
}

export type IndustryTemplate = {
  key: string;
  name: string;
  description: string | null;
  stages: string[];
  orderStages: string[];
  fields: string[];
};

export async function listIndustryTemplates(): Promise<IndustryTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("industry_templates").select("key, name, description, config").order("position");
  if (error) throw new Error(`Could not load industry templates: ${error.message}`);
  type Config = { statuses: { name: string; category: string }[]; order_stages: { name: string }[]; custom_fields: { label: string }[]; measurement_templates: { garment: string }[] };
  return (data ?? []).map((t) => {
    const c = t.config as Config;
    return {
      key: t.key,
      name: t.name,
      description: t.description,
      stages: c.statuses.filter((s) => s.category === "open").map((s) => s.name),
      orderStages: c.order_stages.map((s) => s.name),
      fields: [...c.custom_fields.map((f) => f.label), ...c.measurement_templates.map((m) => `${m.garment} measurements`)],
    };
  });
}

/** The person's demo business, if they have one. */
export async function findDemoBusiness(): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("businesses").select("id, name").eq("is_demo", true).limit(1).maybeSingle();
  return data ? { id: data.id, name: data.name } : null;
}
