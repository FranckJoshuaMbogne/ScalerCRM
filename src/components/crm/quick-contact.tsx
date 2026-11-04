import { MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

/** Call and WhatsApp buttons for an E.164 number. Large tap targets for phones. */
export function QuickContact({ phone, className, compact }: { phone: string | null; className?: string; compact?: boolean }) {
  if (!phone) return null;
  const button =
    "inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-paper";
  return (
    <div className={cn("flex gap-2", className)}>
      <a href={`tel:${phone}`} className={button} aria-label={`Call ${phone}`}>
        <Phone className="size-4" />
        {!compact && "Call"}
      </a>
      <a
        href={`https://wa.me/${phone.replace(/^\+/, "")}`}
        target="_blank"
        rel="noreferrer"
        className={button}
        aria-label={`WhatsApp ${phone}`}
      >
        <MessageCircle className="size-4" />
        {!compact && "WhatsApp"}
      </a>
    </div>
  );
}
