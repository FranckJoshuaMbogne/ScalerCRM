export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="mb-2 h-7 w-48 rounded bg-line" />
      <div className="mb-8 h-4 w-80 max-w-full rounded bg-line/70" />
      <div className="h-64 rounded-[var(--radius-panel)] border border-line bg-surface" />
    </div>
  );
}
