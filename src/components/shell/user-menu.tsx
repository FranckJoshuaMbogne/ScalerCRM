"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut, ShieldCheck } from "lucide-react";
import { PwaMenuItems } from "./pwa";

export function UserMenu({
  initials,
  name,
  email,
  platformAdmin = false,
}: {
  initials: string;
  name: string;
  email: string;
  platformAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white"
      >
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-60 rounded-[var(--radius-panel)] border border-line bg-surface py-1 shadow-lg">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-[13.5px] font-medium">{name}</p>
            <p className="truncate text-[12.5px] text-muted">{email}</p>
          </div>
          {platformAdmin && (
            <Link href="/platform" className="flex w-full items-center gap-2 px-4 py-2.5 text-[13.5px] hover:bg-paper">
              <ShieldCheck className="size-4 text-muted" /> Platform console
            </Link>
          )}
          <PwaMenuItems />
          <form action="/auth/signout" method="post">
            <button className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13.5px] hover:bg-paper">
              <LogOut className="size-4 text-muted" /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
