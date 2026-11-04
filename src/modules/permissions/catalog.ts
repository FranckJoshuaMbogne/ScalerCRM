/**
 * Permission catalogue. The database is the source of truth
 * (supabase/migrations/*_foundation.sql); this mirror gives the app typed keys.
 * catalog.test.ts fails if the two drift apart.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "leads.view_all",
  "leads.view_assigned",
  "leads.create",
  "leads.edit",
  "leads.assign",
  "leads.delete",
  "leads.export",
  "customers.view_all",
  "customers.view_assigned",
  "customers.create",
  "customers.edit",
  "customers.merge",
  "customers.export",
  "inbox.view_all",
  "inbox.view_assigned",
  "inbox.reply",
  "campaigns.view",
  "campaigns.manage",
  "campaigns.send",
  "templates.manage",
  "appointments.view",
  "appointments.manage",
  "orders.view_all",
  "orders.view_assigned",
  "orders.create",
  "orders.edit",
  "orders.fulfil",
  "payments.view",
  "payments.record",
  "payments.refund",
  "tasks.view_all",
  "tasks.manage",
  "analytics.view",
  "analytics.marketing",
  "analytics.sales",
  "analytics.financial",
  "reports.export",
  "team.members.manage",
  "team.roles.manage",
  "settings.business.manage",
  "settings.branches.manage",
  "settings.pipeline.manage",
  "settings.custom_fields.manage",
  "settings.orders.manage",
  "integrations.manage",
  "automation.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Built-in tenant roles. Platform super admin is a profile flag, not a role. */
export const SYSTEM_ROLES = [
  "business_admin",
  "marketing_manager",
  "sales_manager",
  "sales_executive",
  "store_manager",
  "production_manager",
  "accounts",
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

export function hasPermission(
  granted: ReadonlySet<string> | readonly string[],
  permission: Permission,
): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  return set.has(permission);
}
