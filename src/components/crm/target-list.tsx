import { cn } from "@/lib/utils";
import { formatMetric } from "@/modules/analytics/metrics";
import type { TargetProgress } from "@/modules/branch-reporting/queries";
import { pace, periodLabel, TARGET_METRICS } from "@/modules/branch-reporting/targets";

const PACE = {
  ahead: { label: "Ahead", className: "text-stage-won" },
  on_track: { label: "On track", className: "text-muted" },
  behind: { label: "Behind", className: "text-danger" },
} as const;

/** Targets with a progress bar and a marker for where they should be by now. */
export function TargetList({ targets, currency, showWho = true }: { targets: TargetProgress[]; currency: string; showWho?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {targets.map((t) => {
        const m = TARGET_METRICS[t.metric];
        const fmt = (v: number) => formatMetric(v, m.money ? "money" : "count", currency);
        const p = pace(t.percent, t.expected_percent);
        return (
          <li key={t.id} className="px-5 py-3 text-[13.5px]">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">
                {showWho ? `${t.person_name ?? t.branch_name ?? "Whole business"} · ` : ""}
                {m.label}
              </span>
              <span className="text-[12.5px] text-muted">{periodLabel(t.period_start, t.period_type)}</span>
              <span className="ml-auto tabular-nums">
                {fmt(t.actual)} <span className="text-muted">of {fmt(t.target)}</span>
              </span>
            </div>
            <div className="relative mt-1.5 h-2 rounded-full bg-line" title={`${t.percent}% of target; ${t.expected_percent}% of the period has gone`}>
              <div
                className={cn("h-2 rounded-full", p === "behind" ? "bg-danger" : "bg-signal")}
                style={{ width: `${Math.min(100, Math.max(1, t.percent))}%` }}
              />
              <div aria-hidden className="absolute -top-0.5 h-3 w-0.5 bg-text/60" style={{ left: `${Math.min(100, t.expected_percent)}%` }} />
            </div>
            <p className="mt-1 text-[12px] text-muted">
              {t.percent}% done, {t.expected_percent}% of the period gone
              {p && <span className={cn("ml-1 font-medium", PACE[p].className)}>· {PACE[p].label}</span>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
