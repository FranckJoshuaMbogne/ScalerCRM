import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Member = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  roleKey: string;
  status: "invited" | "active" | "suspended" | "removed";
  allBranches: boolean;
  branchIds: string[];
  joinedAt: string | null;
};

export type PendingInvitation = {
  id: string;
  email: string;
  roleName: string;
  allBranches: boolean;
  branchIds: string[];
  expiresAt: string;
  createdAt: string;
};

export type Role = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
};

export type Branch = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  isActive: boolean;
};

export type PermissionInfo = { key: string; module: string; description: string };

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

export async function listMembers(businessId: string): Promise<Member[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_memberships")
    .select(
      `id, user_id, status, all_branches, joined_at,
       profile:profiles!business_memberships_user_id_fkey(full_name, email),
       role:roles(id, key, name),
       access:user_branch_access(branch_id)`,
    )
    .eq("business_id", businessId)
    .neq("status", "removed")
    .order("created_at");
  if (error) fail("team", error);

  type Row = {
    id: string;
    user_id: string;
    status: Member["status"];
    all_branches: boolean;
    joined_at: string | null;
    profile: { full_name: string | null; email: string | null } | null;
    role: { id: string; key: string; name: string } | null;
    access: { branch_id: string }[];
  };
  return (data as unknown as Row[]).map((r) => ({
    membershipId: r.id,
    userId: r.user_id,
    name: r.profile?.full_name || r.profile?.email || "Unknown",
    email: r.profile?.email ?? "",
    roleId: r.role?.id ?? "",
    roleName: r.role?.name ?? "",
    roleKey: r.role?.key ?? "",
    status: r.status,
    allBranches: r.all_branches,
    branchIds: r.access.map((a) => a.branch_id),
    joinedAt: r.joined_at,
  }));
}

export async function listPendingInvitations(businessId: string): Promise<PendingInvitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, all_branches, branch_ids, expires_at, created_at, role:roles(name)")
    .eq("business_id", businessId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) fail("invitations", error);

  type Row = {
    id: string;
    email: string;
    all_branches: boolean;
    branch_ids: string[];
    expires_at: string;
    created_at: string;
    role: { name: string } | null;
  };
  return (data as unknown as Row[]).map((r) => ({
    id: r.id,
    email: r.email,
    roleName: r.role?.name ?? "",
    allBranches: r.all_branches,
    branchIds: r.branch_ids,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}

export async function listRoles(businessId: string): Promise<Role[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .select("id, key, name, description, is_system, business_id, grants:role_permissions(permission_key)")
    .or(`business_id.is.null,business_id.eq.${businessId}`)
    .order("is_system", { ascending: false })
    .order("created_at");
  if (error) fail("roles", error);

  type Row = {
    id: string;
    key: string;
    name: string;
    description: string | null;
    is_system: boolean;
    grants: { permission_key: string }[];
  };
  return (data as unknown as Row[]).map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.is_system,
    permissions: r.grants.map((g) => g.permission_key),
  }));
}

export async function listBranches(businessId: string): Promise<Branch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("branches")
    .select("id, name, code, phone, address_line, city, state, postal_code, is_active")
    .eq("business_id", businessId)
    .order("created_at");
  if (error) fail("branches", error);
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    phone: b.phone,
    addressLine: b.address_line,
    city: b.city,
    state: b.state,
    postalCode: b.postal_code,
    isActive: b.is_active,
  }));
}

export async function listPermissions(): Promise<PermissionInfo[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("permissions").select("key, module, description").order("key");
  if (error) fail("permissions", error);
  return data ?? [];
}
