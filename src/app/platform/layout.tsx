import Link from "next/link";
import { Wordmark } from "@/components/shell/wordmark";

export const metadata = { title: { default: "Platform", template: "%s · SCALER platform" } };

/** Springs 360's console. Each page checks the platform-admin flag itself. */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="flex h-14 items-center gap-6 bg-ink px-4 text-white sm:px-6">
        <Wordmark />
        <span className="rounded bg-white/10 px-2 py-0.5 text-[12px] tracking-wide">PLATFORM</span>
        <nav className="flex gap-4 text-[13.5px]">
          <Link href="/platform" className="hover:underline">
            Businesses
          </Link>
          <Link href="/platform/plans" className="hover:underline">
            Plans
          </Link>
          <Link href="/platform/billing" className="hover:underline">
            Billing
          </Link>
          <Link href="/platform/onboarding" className="hover:underline">
            Signups
          </Link>
          <Link href="/dashboard" className="text-white/70 hover:underline">
            Back to the app
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6">{children}</main>
    </div>
  );
}
