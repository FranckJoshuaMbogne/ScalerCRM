"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, fieldErrors, friendlyDbError } from "@/lib/forms";
import { siteOrigin } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";
import { PERMISSIONS } from "@/modules/permissions/catalog";
import { PermissionError, requirePermission } from "@/modules/tenancy/session";
import { roleKey } from "@/modules/tenancy/slug";

/** Runs an action body so permission failures come back as a message, not a crash. */
async function guard(fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, message: e.message };
    throw e;
  }
}

const uuid = z.uuid();

function branchAccess(form: FormData) {
  const all = form.get("access") !== "selected";
  const branchIds = all ? [] : form.getAll("branchIds").map(String).filter((id) => uuid.safeParse(id).success);
  return { all, branchIds };
}

const inviteSchema = z.object({
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  roleId: z.uuid("Choose a role."),
});

export async function inviteMember(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
  const ctx = await requirePermission("team.members.manage");
  const parsed = inviteSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fieldErrors(parsed.error, form);
  const { all, branchIds } = branchAccess(form);
  if (!all && branchIds.length === 0) {
    return { ok: false, fieldErrors: { branchIds: "Pick at least one branch." }, message: "Check the highlighted fields." };
  }

  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("create_invitation", {
    p_business_id: ctx.business.businessId,
    p_email: parsed.data.email,
    p_role_id: parsed.data.roleId,
    p_default_branch_id: all ? null : branchIds[0],
    p_all_branches: all,
    p_branch_ids: branchIds,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };

  refresh();
  return {
    ok: true,
    message: `Invitation created for ${parsed.data.email}. Share this link with them. It works once and expires in 7 days.`,
    data: { link: `${await siteOrigin()}/invite/${token}` },
  };
  });
}

export async function revokeInvitation(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
  const ctx = await requirePermission("team.members.manage");
  const id = uuid.parse(form.get("invitationId"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("business_id", ctx.business.businessId);
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Invitation cancelled." };
  });
}

export async function updateMember(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
  const ctx = await requirePermission("team.members.manage");
  const membershipId = uuid.parse(form.get("membershipId"));
  const roleId = uuid.parse(form.get("roleId"));
  const { all, branchIds } = branchAccess(form);
  if (!all && branchIds.length === 0) return { ok: false, message: "Pick at least one branch or choose all branches." };

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("business_memberships")
    .update({ role_id: roleId, all_branches: all, default_branch_id: all ? null : branchIds[0] })
    .eq("id", membershipId)
    .eq("business_id", ctx.business.businessId)
    .select("id");
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!updated?.length) return { ok: false, message: "You can't change your own role. Ask another admin." };

  const { error: delError } = await supabase.from("user_branch_access").delete().eq("membership_id", membershipId);
  if (delError) return { ok: false, message: friendlyDbError(delError) };
  if (!all) {
    const { error: insError } = await supabase
      .from("user_branch_access")
      .insert(branchIds.map((branch_id) => ({ membership_id: membershipId, branch_id })));
    if (insError) return { ok: false, message: friendlyDbError(insError) };
  }
  refresh();
  return { ok: true, message: "Access updated." };
  });
}

const statusSchema = z.enum(["active", "suspended", "removed"]);

export async function setMemberStatus(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
  const ctx = await requirePermission("team.members.manage");
  const membershipId = uuid.parse(form.get("membershipId"));
  const status = statusSchema.parse(form.get("status"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_memberships")
    .update({ status })
    .eq("id", membershipId)
    .eq("business_id", ctx.business.businessId)
    .select("id");
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!data?.length) return { ok: false, message: "You can't change your own access." };
  refresh();
  return {
    ok: true,
    message: status === "active" ? "Access restored." : status === "suspended" ? "Access paused." : "Removed from the business.",
  };
  });
}

const roleSchema = z.object({
  roleId: z.uuid().optional().or(z.literal("")),
  name: z.string().trim().min(2, "Name the role.").max(60),
  description: z.string().trim().max(200).optional(),
});

export async function saveRole(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
  const ctx = await requirePermission("team.roles.manage");
  const parsed = roleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fieldErrors(parsed.error, form);
  const valid = new Set<string>(PERMISSIONS);
  const permissions = [...new Set(form.getAll("permissions").map(String))].filter((p) => valid.has(p));
  if (permissions.length === 0) return { ok: false, message: "Give the role at least one permission." };

  const supabase = await createClient();
  let id = parsed.data.roleId || "";
  if (id) {
    const { error } = await supabase
      .from("roles")
      .update({ name: parsed.data.name, description: parsed.data.description || null })
      .eq("id", id)
      .eq("business_id", ctx.business.businessId);
    if (error) return { ok: false, message: friendlyDbError(error) };
    const { error: delError } = await supabase.from("role_permissions").delete().eq("role_id", id);
    if (delError) return { ok: false, message: friendlyDbError(delError) };
  } else {
    const { data, error } = await supabase
      .from("roles")
      .insert({
        business_id: ctx.business.businessId,
        key: roleKey(parsed.data.name),
        name: parsed.data.name,
        description: parsed.data.description || null,
      })
      .select("id")
      .single();
    if (error) return { ok: false, message: friendlyDbError(error) };
    id = data.id;
  }

  const { error } = await supabase
    .from("role_permissions")
    .insert(permissions.map((permission_key) => ({ role_id: id, permission_key })));
  if (error) return { ok: false, message: friendlyDbError(error) };

  refresh();
  return { ok: true, message: `Saved “${parsed.data.name}”.` };
  });
}

export async function deleteRole(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
  const ctx = await requirePermission("team.roles.manage");
  const id = uuid.parse(form.get("roleId"));
  const supabase = await createClient();
  const { error } = await supabase.from("roles").delete().eq("id", id).eq("business_id", ctx.business.businessId);
  if (error) {
    return {
      ok: false,
      message: error.code === "23503" ? "Someone still has this role. Move them to another role first." : friendlyDbError(error),
    };
  }
  refresh();
  return { ok: true, message: "Role deleted." };
  });
}
