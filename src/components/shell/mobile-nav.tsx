"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { workspaceNav } from "./nav-config";

const items = workspaceNav.filter((item) => item.mobile);

export function MobileNav() {
  const pathname = usePathname();
  const tabs = [
    ...items.map((i) => ({ href: i.href, label: i.label, Icon: i.icon })),
    { href: "/more", label: "More", Icon: Menu },
  ];
  return (
    <nav
      aria-label="Quick"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 text-[11px] text-muted",
                  active && "text-signal",
                )}
              >
                <Icon className="size-5" strokeWidth={1.75} />
                <span className="max-w-full truncate px-1">
                  {label === "WhatsApp inbox" ? "Inbox" : label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
