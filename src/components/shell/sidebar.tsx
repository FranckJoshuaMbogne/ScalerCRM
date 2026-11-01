"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { adminNav, type NavItem, workspaceNav } from "./nav-config";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavGroup({ title, items }: { title: string; items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <div>
      <p className="px-3 pb-1.5 text-[11px] font-medium text-ink-muted">
        {title}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-[13.5px] text-ink-fg/80 transition-colors hover:bg-white/5 hover:text-ink-fg",
                  active && "bg-white/8 font-medium text-white",
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-y-1.5 -left-3 w-[3px] rounded-r bg-signal"
                  />
                )}
                <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SidebarNav() {
  return (
    <nav aria-label="Main" className="flex flex-col gap-6 px-3">
      <NavGroup title="Workspace" items={workspaceNav} />
      <NavGroup title="Administration" items={adminNav} />
    </nav>
  );
}
