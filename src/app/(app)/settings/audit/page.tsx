import Link from "next/link";
import { NoAccess } from "@/components/ui/no-access";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { type AuditEntry, listAuditLog } from "@/modules/settings/queries";
import { can, getContext } from "@/modules/tenancy/session";

export const metadata = { title: "Audit log" };

const ENTITY: Record<string, string> = {
  businesses: "business details",
  branches: "a branch",
  business_memberships: "a team member",
  roles: "a role",
  invitations: "an invitation",
};

const VERB: Record<AuditEntry["action"], string> = { insert: "added", update: "changed", delete: "deleted" };

function summarise(e: AuditEntry) {
  const thing = ENTITY[e.entityType] ?? e.entityType.replace(/_/g, " ");
  const name = typeof e.changes?.name === "string" ? ` “${e.changes.name}”` : "";
  if (e.action !== "update" || !e.changes) return `${VERB[e.action]} ${thing}${name}`;
  const fields = Object.keys(e.changes).map((f) => f.replace(/_id$/, "").replace(/_/g, " "));
  return `changed ${fields.join(", ")} on ${thing}`;
}

export default async function AuditPage() {
  const ctx = await getContext();
  if (!can(ctx, "audit.view")) return <NoAccess what="the audit log" />;

  const entries = await listAuditLog(ctx.business.businessId);
  const fmt = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.business.timezone,
  });

  return (
    <>
      <Link href="/settings" className="mb-3 inline-block text-[13.5px] text-signal hover:underline">
        Settings
      </Link>
      <PageHeader
        title="Audit log"
        description="Every change to business settings, branches, roles and team access. Entries can't be edited or deleted."
      />
      <Panel>
        {entries.length === 0 ? (
          <p className="px-5 py-8 text-[14px] text-muted">No changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-5 py-3 text-[13.5px]">
                <time className="w-44 shrink-0 text-[12.5px] text-muted tabular-nums">{fmt.format(new Date(e.createdAt))}</time>
                <p className="flex-1">
                  <span className="font-medium">{e.actorName}</span> {summarise(e)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
