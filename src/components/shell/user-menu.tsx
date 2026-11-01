"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export function UserMenu({ initials, name, email }: { initials: string; name: string; email: string }) {
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
