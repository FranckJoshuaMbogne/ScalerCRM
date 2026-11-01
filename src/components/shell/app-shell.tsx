import { Suspense } from "react";
import { Bell, Search } from "lucide-react";
import { getContext, initials } from "@/modules/tenancy/session";
import { BusinessSwitcher } from "./business-switcher";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar";
import { UserMenu } from "./user-menu";
import { Wordmark } from "./wordmark";

async function Switcher() {
  const ctx = await getContext();
  return <BusinessSwitcher current={ctx.business} options={ctx.memberships} />;
}

async function Account() {
  const { user } = await getContext();
  return (
    <UserMenu
      initials={initials(user.fullName, user.email)}
      name={user.fullName ?? user.email}
      email={user.email}
    />
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col gap-5 overflow-y-auto bg-ink py-5 lg:flex">
        <Wordmark className="px-6" />
        <Suspense fallback={<div className="mx-3 h-[52px] rounded-[var(--radius-control)] bg-ink-2" />}>
          <Switcher />
        </Suspense>
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
        <Suspense fallback={<span className="size-8 shrink-0 rounded-full bg-line" />}>
          <Account />
        </Suspense>
      </header>

      <main className="px-4 pt-6 pb-24 sm:px-6 lg:px-8 lg:pb-10">{children}</main>

      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
    </div>
  );
}
