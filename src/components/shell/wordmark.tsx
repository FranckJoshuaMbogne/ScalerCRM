import Link from "next/link";
import { cn } from "@/lib/utils";

export function Wordmark({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  return (
    <Link
      href="/dashboard"
      aria-label="SCALER home"
      className={cn("flex items-center gap-2.5", tone === "light" ? "text-white" : "text-text", className)}
    >
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <path
          d="M4 18 L10 12 L14 15 L20 6"
          fill="none"
          stroke="var(--signal)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="20" cy="6" r="2" fill="currentColor" />
      </svg>
      <span className="text-[17px] font-semibold tracking-[0.08em]">SCALER</span>
    </Link>
  );
}
