"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { switchBusiness } from "@/modules/tenancy/actions";

type Option = { businessId: string; businessName: string; roleName: string };

export function BusinessSwitcher({ current, options }: { current: Option; options: Option[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mx-3">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-[var(--radius-control)] bg-ink-2 px-3 py-2.5 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-white">{current.businessName}</span>
          <span className="block truncate text-[11.5px] text-ink-muted">{current.roleName}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-ink-muted" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-[var(--radius-control)] border border-white/10 bg-ink-2 py-1 shadow-lg">
          {options.map((o) => (
            <form key={o.businessId} action={switchBusiness}>
              <input type="hidden" name="businessId" value={o.businessId} />
              <button
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink-fg hover:bg-white/5",
                  o.businessId === current.businessId && "text-white",
                )}
              >
                <Check className={cn("size-3.5", o.businessId !== current.businessId && "invisible")} />
                <span className="truncate">{o.businessName}</span>
              </button>
            </form>
          ))}
          <Link
            href="/onboarding?new=1"
            className="flex items-center gap-2 border-t border-white/10 px-3 py-2 text-[13px] text-ink-muted hover:bg-white/5 hover:text-white"
          >
            <Plus className="size-3.5" /> Add a business
          </Link>
        </div>
      )}
    </div>
  );
}
