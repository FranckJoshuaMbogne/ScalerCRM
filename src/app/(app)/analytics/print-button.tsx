"use client";

/** Opens the browser's print dialog; "Save as PDF" gives a PDF of the dashboard. */
export function PrintButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => window.print()}
      className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 text-[13.5px] font-medium hover:bg-paper">
      {children}
    </button>
  );
}
