import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type MeasurementTemplate = { id: string; garment: string; fields: { key: string; label: string }[]; position: number; isActive: boolean };

export const listMeasurementTemplates = cache(async (businessId: string): Promise<MeasurementTemplate[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("measurement_templates")
    .select("id, garment, fields, position, is_active")
    .eq("business_id", businessId)
    .order("position");
  if (error) throw new Error(`Could not load measurement templates: ${error.message}`);
  return (data ?? []).map((t) => ({ id: t.id, garment: t.garment, fields: t.fields ?? [], position: t.position, isActive: t.is_active }));
});

export type Measurement = {
  id: string;
  garment: string;
  unit: "in" | "cm";
  readings: Record<string, number>;
  notes: string | null;
  takenBy: string | null;
  takenAt: string;
};

/** Every measurement session for a customer, newest first. */
export async function listCustomerMeasurements(customerId: string): Promise<Measurement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_measurements")
    .select("id, garment, unit, readings, notes, taken_by, taken_at")
    .eq("customer_id", customerId)
    .order("taken_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not load measurements: ${error.message}`);
  return (data ?? []).map((m) => ({
    id: m.id,
    garment: m.garment,
    unit: m.unit,
    readings: m.readings ?? {},
    notes: m.notes,
    takenBy: m.taken_by,
    takenAt: m.taken_at,
  }));
}
