import { cn } from "@/lib/utils";
import type { UsageRow } from "@/modules/plans/limits";

/** Usage against each plan limit, as labelled bars. */
export function UsageBars({ rows }: { rows: UsageRow[] }) {
  return (
    <ul className="space-y-4">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
            <span className="font-medium">
              {r.label}
              {r.period && <span className="font-normal text-muted"> · {r.period}</span>}
            </span>
            <span className={cn("tabular-nums", r.level === "full" ? "text-danger" : r.level === "near" ? "text-text" : "text-muted")}>
              {r.used.toLocaleString("en-IN")} / {r.limit === null ? "unlimited" : r.limit.toLocaleString("en-IN")}
            </span>
          </div>
          {r.percent !== null && (
            <div className="mt-1.5 h-2 rounded-full bg-line" role="presentation">
              <div
                className={cn("h-2 rounded-full", r.level === "full" ? "bg-danger" : r.level === "near" ? "bg-stage-negotiation" : "bg-signal")}
                style={{ width: `${Math.max(r.percent, 2)}%` }}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
