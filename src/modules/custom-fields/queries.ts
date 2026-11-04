import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition, FieldEntity, FieldType } from "./engine";

type Row = {
  id: string;
  entity: FieldEntity;
  key: string;
  label: string;
  field_type: FieldType;
  options: string[];
  is_required: boolean;
  help_text: string | null;
  position: number;
  is_active: boolean;
};

export async function listFieldDefinitions(
  businessId: string,
  entity?: FieldEntity,
  { includeInactive = false } = {},
): Promise<FieldDefinition[]> {
  const supabase = await createClient();
  let query = supabase
    .from("custom_field_definitions")
    .select("id, entity, key, label, field_type, options, is_required, help_text, position, is_active")
    .eq("business_id", businessId)
    .order("entity")
    .order("position")
    .order("created_at");
  if (entity) query = query.eq("entity", entity);
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query.returns<Row[]>();
  if (error) throw new Error(`Could not load custom fields: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    entity: r.entity,
    key: r.key,
    label: r.label,
    type: r.field_type,
    options: r.options ?? [],
    required: r.is_required,
    helpText: r.help_text,
    position: r.position,
    isActive: r.is_active,
  }));
}
