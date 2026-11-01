import { Wordmark } from "@/components/shell/wordmark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="hidden flex-col justify-between bg-ink p-10 text-ink-fg lg:flex">
        <Wordmark />
        <div className="max-w-sm">
          <p className="text-[26px] leading-snug font-semibold text-white">
            Every enquiry, from first message to delivered order, in one place.
          </p>
          <ul className="mt-8 space-y-3 text-[14px] text-ink-muted">
            <li>Leads from Meta, Google, WhatsApp, your website and walk-ins</li>
            <li>One customer file per person, however many times they enquire</li>
            <li>Follow-ups, orders and payments with a clear owner</li>
          </ul>
        </div>
        <p className="text-[12px] text-ink-muted">SCALER by Springs 360</p>
      </aside>
      <main className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mb-10 lg:hidden">
          <Wordmark tone="dark" />
        </div>
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
