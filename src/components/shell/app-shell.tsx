import { Suspense } from "react";
import { Bell, Search } from "lucide-react";
import { countUnreadNotifications } from "@/modules/notifications/queries";
import { getContext, initials } from "@/modules/tenancy/session";
import { BusinessSwitcher } from "./business-switcher";
import { MobileNav } from "./mobile-nav";
import { NotificationBell } from "./notification-bell";
import { PwaRegister } from "./pwa";
import { StatusBanner } from "./status-banner";
import { SidebarNav } from "./sidebar";
import { UserMenu } from "./user-menu";
import { BrandMark, BrandShortName, BrandStyle, PoweredBy } from "./brand";

async function Switcher() {
  const ctx = await getContext();
  return <BusinessSwitcher current={ctx.business} options={ctx.memberships} />;
}

async function Notifications() {
  const ctx = await getContext();
  const unread = await countUnreadNotifications(ctx.business.businessId);
  return <NotificationBell userId={ctx.user.id} businessId={ctx.business.businessId} initialUnread={unread} />;
}

function BellPlaceholder() {
  return (
    <span aria-hidden className="ml-auto rounded-full p-2 text-muted">
      <Bell className="size-[18px]" />
    </span>
  );
}

async function Account() {
  const { user } = await getContext();
  return (
    <UserMenu
      platformAdmin={user.isPlatformAdmin}
      initials={initials(user.fullName, user.email)}
      name={user.fullName ?? user.email}
      email={user.email}
    />
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:pl-64">
      <PwaRegister />
      <Suspense fallback={null}>
        <BrandStyle />
      </Suspense>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col gap-5 overflow-y-auto bg-ink py-5 lg:flex">
        <Suspense fallback={<span className="block h-7" />}>
          <BrandMark className="px-6" />
        </Suspense>
        <Suspense fallback={<div className="mx-3 h-[52px] rounded-[var(--radius-control)] bg-ink-2" />}>
          <Switcher />
        </Suspense>
        <Suspense fallback={null}>
          <SidebarNav />
        </Suspense>
        <Suspense fallback={null}>
          <PoweredBy className="mt-auto px-6" />
        </Suspense>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
        <Suspense fallback={null}>
          <BrandShortName />
        </Suspense>
        <form action="/customers" role="search" className="relative ml-auto w-full max-w-sm lg:ml-0">
          <label htmlFor="global-search" className="sr-only">Search customers by name, phone or CIF</label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            id="global-search"
            type="search"
            name="q"
            placeholder="Search by name, phone or CIF"
            className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-paper pr-3 pl-9 text-[13.5px] placeholder:text-muted focus:border-signal focus:outline-none"
          />
        </form>
        <Suspense fallback={<BellPlaceholder />}>
          <Notifications />
        </Suspense>
        <Suspense fallback={<span className="size-8 shrink-0 rounded-full bg-line" />}>
          <Account />
        </Suspense>
      </header>

      <main className="px-4 pt-6 pb-24 sm:px-6 lg:px-8 lg:pb-10">
        <Suspense fallback={null}>
          <StatusBanner />
        </Suspense>
        {children}
      </main>

      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
    </div>
  );
}
