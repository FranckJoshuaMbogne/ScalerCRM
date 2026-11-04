import Link from "next/link";
import { List, SquareKanban, UserPlus } from "lucide-react";

const VIEWS = [
  { href: "/leads", label: "List", icon: List },
  { href: "/leads/board", label: "Board", icon: SquareKanban },
  { href: "/leads/queue", label: "Unassigned", icon: UserPlus },
] as const;

/** Switch between the lead list, the kanban board and the unassigned queue. */
export function LeadViewSwitch({ current, unassigned }: { current: (typeof VIEWS)[number]["href"]; unassigned?: number }) {
  return (
    <nav aria-label="Lead layouts" className="inline-flex rounded-[var(--radius-control)] border border-line bg-surface p-0.5">
      {VIEWS.map((v) => (
        <Link
          key={v.href}
          href={v.href}
          aria-current={current === v.href ? "page" : undefined}
          className="inline-flex h-8 items-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-2.5 text-[13px] text-muted hover:text-text aria-[current=page]:bg-paper aria-[current=page]:font-medium aria-[current=page]:text-text"
        >
          <v.icon className="size-4" />
          {v.label}
          {v.href === "/leads/queue" && unassigned ? (
            <span className="rounded-full bg-signal px-1.5 text-[11px] font-semibold text-white tabular-nums">{unassigned}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
