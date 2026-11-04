"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { loadNotifications, markNotificationsRead } from "@/modules/notifications/actions";
import type { Notification } from "@/modules/notifications/queries";

type Row = { id: number; business_id: string; type: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

function ago(iso: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/**
 * Header bell. New notifications arrive live over Supabase Realtime
 * (RLS limits the stream to the signed-in user); the list loads on open.
 */
export function NotificationBell({
  userId,
  businessId,
  initialUnread,
}: {
  userId: string;
  businessId: string;
  initialUnread: number;
}) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);
  const [, startTransition] = useTransition();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Row;
          if (n.business_id !== businessId) return;
          setUnread((u) => u + 1);
          setItems((list) =>
            list
              ? [{ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.read_at, createdAt: n.created_at }, ...list]
              : list,
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, businessId]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !panel.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setNow(Date.now());
      startTransition(async () => {
        const data = await loadNotifications();
        setItems(data.items);
        setUnread(data.unread);
      });
    }
  }

  function readAll() {
    setUnread(0);
    setItems((list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? list);
    startTransition(() => markNotificationsRead());
  }

  return (
    <div ref={panel} className="relative ml-auto">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative rounded-full p-2 text-muted hover:bg-paper"
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-14 z-50 rounded-[var(--radius-panel)] border border-line bg-surface shadow-xl sm:absolute sm:inset-x-auto sm:top-11 sm:right-0 sm:w-96">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-semibold">Notifications</h2>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="text-[12.5px] font-medium text-signal hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {items === null ? (
              <li className="px-4 py-6 text-center text-[13px] text-muted">Loading…</li>
            ) : items.length === 0 ? (
              <li className="px-4 py-6 text-center text-[13px] text-muted">
                Nothing yet. Assignments and overdue follow-ups show up here.
              </li>
            ) : (
              items.map((n) => {
                const body = (
                  <>
                    <p className={cn("text-[13.5px]", !n.readAt && "font-semibold")}>{n.title}</p>
                    {n.body && <p className="text-[12.5px] text-muted">{n.body}</p>}
                    <p className="mt-0.5 text-[11.5px] text-muted">{ago(n.createdAt, now)}</p>
                  </>
                );
                return (
                  <li key={n.id} className={cn(!n.readAt && "bg-signal-soft/40")}>
                    {n.link ? (
                      <Link
                        href={n.link}
                        onClick={() => {
                          setOpen(false);
                          if (!n.readAt) {
                            setUnread((u) => Math.max(0, u - 1));
                            startTransition(() => markNotificationsRead(n.id));
                          }
                        }}
                        className="block px-4 py-3 hover:bg-paper"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="px-4 py-3">{body}</div>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
