import "server-only";
import { createClient } from "@/lib/supabase/server";

export type RotationMember = {
  id: string;
  branchId: string | null;
  userId: string;
  isActive: boolean;
  lastAssignedAt: string | null;
};

export async function getAssignmentSettings(businessId: string) {
  const supabase = await createClient();
  const [{ data: settings, error }, { data: members, error: membersError }] = await Promise.all([
    supabase.from("lead_assignment_settings").select("round_robin_enabled").eq("business_id", businessId).maybeSingle(),
    supabase
      .from("round_robin_members")
      .select("id, branch_id, user_id, is_active, last_assigned_at")
      .eq("business_id", businessId)
      .order("created_at"),
  ]);
  if (error) throw new Error(`Could not load assignment settings: ${error.message}`);
  if (membersError) throw new Error(`Could not load the rotation: ${membersError.message}`);
  return {
    roundRobin: settings?.round_robin_enabled ?? false,
    members: (members ?? []).map(
      (m): RotationMember => ({
        id: m.id,
        branchId: m.branch_id,
        userId: m.user_id,
        isActive: m.is_active,
        lastAssignedAt: m.last_assigned_at,
      }),
    ),
  };
}
