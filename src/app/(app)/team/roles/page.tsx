import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { deleteRole } from "@/modules/team/actions";
import { listPermissions, listRoles } from "@/modules/team/queries";
import { can, getContext } from "@/modules/tenancy/session";
import { RoleEditor } from "./role-editor";

export const metadata = { title: "Roles and permissions" };

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  leads: "Leads",
  customers: "Customers",
  inbox: "WhatsApp inbox",
  campaigns: "Campaigns and templates",
  appointments: "Appointments and walk-ins",
  orders: "Orders",
  payments: "Payments",
  tasks: "Tasks",
  analytics: "Analytics",
  reports: "Reports",
  team: "Team",
  settings: "Settings",
  integrations: "Integrations",
  automation: "Automation",
};

export default async function RolesPage() {
  const ctx = await getContext();
  const manage = can(ctx, "team.roles.manage");
  const [roles, permissions] = await Promise.all([listRoles(ctx.business.businessId), listPermissions()]);

  const order = Object.keys(MODULE_LABELS);
  const groups = order
    .map((module) => ({
      module,
      label: MODULE_LABELS[module],
      items: permissions.filter((p) => p.module === module).map((p) => ({ key: p.key, description: p.description })),
    }))
    .filter((g) => g.items.length > 0);
  const describe = new Map(permissions.map((p) => [p.key, p.description]));

  return (
    <>
      <Link href="/team" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Team & roles
      </Link>
      <PageHeader
        title="Roles and permissions"
        description="Built-in roles cover the usual jobs. Create your own when someone needs a different mix."
      />

      <Panel className="mb-6">
        <ul className="divide-y divide-line">
          {roles.map((role) => (
            <li key={role.id} className="px-5 py-3.5">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 select-none">
                  <span className="text-[14px] font-medium">{role.name}</span>
                  <span className="text-[12px] text-muted">{role.isSystem ? "Built-in" : "Custom"}</span>
                  <span className="flex-1 text-[13px] text-muted">{role.description}</span>
                  <span className="text-[13px] text-muted">{role.permissions.length} permissions</span>
                </summary>
                <div className="mt-4">
                  {role.isSystem || !manage ? (
                    <ul className="grid gap-x-8 gap-y-1 text-[13px] text-muted sm:grid-cols-2">
                      {role.permissions
                        .map((k) => describe.get(k) ?? k)
                        .sort()
                        .map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                    </ul>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <RoleEditor groups={groups} role={role} />
                      <ActionForm action={deleteRole} className="border-t border-line pt-4">
                        <input type="hidden" name="roleId" value={role.id} />
                        <SubmitButton variant="danger">Delete role</SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Panel>

      {manage && (
        <Panel className="p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Create a custom role</h2>
          <RoleEditor groups={groups} />
        </Panel>
      )}
    </>
  );
}
