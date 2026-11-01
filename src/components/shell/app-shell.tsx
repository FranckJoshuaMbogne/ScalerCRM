import Link from "next/link";
import { Suspense } from "react";
import { Bell, ChevronsUpDown, Search } from "lucide-react";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar";

function Wordmark() {
  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-2.5 px-6 text-white"
      aria-label="SCALER home"
    >
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <path d="M4 18 L10 12 L14 15 L20 6" fill="none" stroke="var(--signal)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="20" cy="6" r="2" fill="white" />
      </svg>
      <span className="text-[17px] font-semibold tracking-[0.08em]">SCALER</span>
    </Link>
  );
}

/** Placeholder until Sprint 1 wires real memberships. */
function BusinessSwitcher() {
  return (
    <button
      type="button"
      className="mx-3 flex items-center justify-between rounded-[var(--radius-control)] bg-ink-2 px-3 py-2.5 text-left"
    >
      <span>
        <span className="block text-[13px] font-medium text-white">My Perfect Fit</span>
        <span className="block text-[11.5px] text-ink-muted">Hyderabad studio</span>
      </span>
      <ChevronsUpDown className="size-4 text-ink-muted" />
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col gap-5 overflow-y-auto bg-ink py-5 lg:flex">
        <Wordmark />
        <BusinessSwitcher />
        <Suspense fallback={null}>
          <SidebarNav />
        </Suspense>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
        <span className="font-semibold tracking-[0.08em] lg:hidden">SCALER</span>
        <label className="relative ml-auto w-full max-w-sm lg:ml-0">
          <span className="sr-only">Search customers, leads and orders</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Search by name, phone, CIF or order number"
            className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-paper pr-3 pl-9 text-[13.5px] placeholder:text-muted focus:border-signal focus:outline-none"
          />
        </label>
        <button type="button" aria-label="Notifications" className="ml-auto rounded-full p-2 text-muted hover:bg-paper">
          <Bell className="size-[18px]" />
        </button>
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white">
          FM
        </span>
      </header>

      <main className="px-4 pt-6 pb-24 sm:px-6 lg:px-8 lg:pb-10">{children}</main>

      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
    </div>
  );
}
