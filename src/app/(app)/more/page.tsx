import Link from "next/link";
import { adminNav, workspaceNav } from "@/components/shell/nav-config";
import { PageHeader, Panel } from "@/components/ui/primitives";

export const metadata = { title: "All modules" };

export default function MorePage() {
  return (
    <>
      <PageHeader title="All modules" />
      {[
        { title: "Workspace", items: workspaceNav },
        { title: "Administration", items: adminNav },
      ].map((group) => (
        <Panel key={group.title} className="mb-4">
          <h2 className="border-b border-line px-4 py-3 text-[13px] font-medium text-muted">
            {group.title}
          </h2>
          <ul className="divide-y divide-line">
            {group.items.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link href={href} className="flex items-center gap-3 px-4 py-3 text-[15px]">
                  <Icon className="size-5 text-muted" strokeWidth={1.75} />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </>
  );
}
