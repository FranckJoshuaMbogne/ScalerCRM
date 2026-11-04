import { cn } from "@/lib/utils";

const LABEL = { draft: "Draft", scheduled: "Scheduled", sending: "Sending", paused: "Paused", completed: "Completed", cancelled: "Cancelled" } as const;

export function CampaignStatus({ status }: { status: keyof typeof LABEL }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium",
      status === "sending" ? "bg-stage-new/15" : status === "completed" ? "bg-stage-won/15" : status === "paused" || status === "scheduled" ? "bg-stage-negotiation/15" : "bg-line")}>
      {LABEL[status]}
    </span>
  );
}
