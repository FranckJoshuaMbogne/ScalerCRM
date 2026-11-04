import { cn } from "@/lib/utils";
import { paymentState } from "@/modules/orders/money";

const STAGE_TONE = {
  open: "bg-stage-qualified",
  done: "bg-stage-won",
  cancelled: "bg-stage-lost",
} as const;

export function OrderStageBadge({ name, category }: { name: string; category: keyof typeof STAGE_TONE }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-[12px] font-medium whitespace-nowrap">
      <span aria-hidden className={cn("inline-block size-2 rounded-full", STAGE_TONE[category])} />
      {name}
    </span>
  );
}

const PAYMENT_LABEL = { unpaid: "Unpaid", partial: "Part paid", paid: "Paid", overpaid: "Refund due" } as const;

export function PaymentBadge({ total, netPaid }: { total: string; netPaid: string }) {
  const s = paymentState(total, netPaid);
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap",
        s === "paid" && "bg-stage-won/15",
        s === "partial" && "bg-stage-negotiation/15",
        s === "unpaid" && "bg-line",
        s === "overpaid" && "bg-danger/10 text-danger",
      )}
    >
      {PAYMENT_LABEL[s]}
    </span>
  );
}

const QUOTE_LABEL = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", expired: "Expired" } as const;

export function QuotationBadge({ status }: { status: keyof typeof QUOTE_LABEL }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[12px] font-medium",
        status === "accepted" ? "bg-stage-won/15" : status === "sent" ? "bg-stage-new/15" : "bg-line",
      )}
    >
      {QUOTE_LABEL[status]}
    </span>
  );
}
