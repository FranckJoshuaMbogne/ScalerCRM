"use client";

import { useEffect, useState } from "react";

type Saved = {
  business: string;
  timeZone: string;
  savedAt: string;
  tasks: { id: string; title: string; dueAt: string; customer: string | null; phone: string | null; lead: string | null }[];
};

export function OfflineTasks() {
  const [saved, setSaved] = useState<Saved | null | undefined>(undefined);

  useEffect(() => {
    const read = "caches" in window ? caches.match("/api/tasks/today") : Promise.resolve(undefined);
    read
      .then((res) => (res ? res.json() : null))
      .then(setSaved)
      .catch(() => setSaved(null));
  }, []);

  if (saved === undefined) return null;
  if (!saved || !saved.tasks) {
    return <p className="mt-6 text-[14px]">No saved tasks on this device yet. Open Tasks once while online.</p>;
  }
  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-IN", { timeZone: saved.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  return (
    <section className="mt-6">
      <p className="text-[13px] text-muted">
        {saved.business} · saved {time(saved.savedAt)}
      </p>
      {saved.tasks.length === 0 ? (
        <p className="mt-3 text-[14px]">Nothing due today.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
          {saved.tasks.map((t) => (
            <li key={t.id} className="px-4 py-3">
              <p className="text-[14px] font-medium">{t.title}</p>
              <p className="text-[13px] text-muted">
                {time(t.dueAt)}
                {t.customer ? ` · ${t.customer}` : ""}
                {t.lead ? ` · ${t.lead}` : ""}
              </p>
              {t.phone && (
                <a href={`tel:${t.phone}`} className="mt-1 inline-block text-[13.5px] text-signal">
                  Call {t.phone}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => location.reload()}
        className="mt-6 h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 text-[13.5px] font-medium"
      >
        Try again
      </button>
    </section>
  );
}
