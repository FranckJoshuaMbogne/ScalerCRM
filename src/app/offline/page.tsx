import { OfflineTasks } from "./offline-tasks";

export const metadata = { title: "Offline" };

/** Shown by the service worker when a page can't load. Static: no session needed. */
export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-[20px] font-semibold">You&apos;re offline</h1>
      <p className="mt-1 text-[14px] text-muted">
        SCALER needs a connection for everything else. Here are your tasks for today as they were when you were last online.
      </p>
      <OfflineTasks />
    </main>
  );
}
