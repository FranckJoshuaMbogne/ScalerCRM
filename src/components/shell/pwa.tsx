"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell, BellOff, Download } from "lucide-react";
import { removePushSubscription, savePushSubscription } from "@/modules/push/actions";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// beforeinstallprompt can fire before any menu is open, so it's kept outside React.
let installEvent: InstallEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribeInstall = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Registers the service worker (production builds only) and remembers the install prompt. */
export function PwaRegister() {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      installEvent = e as InstallEvent;
      emit();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  return null;
}

function key(): Uint8Array<ArrayBuffer> | null {
  const k = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!k) return null;
  const b64 = (k + "=".repeat((4 - (k.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const item = "flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13.5px] hover:bg-paper disabled:opacity-60";

/** "Install app" and "Phone notifications" entries for the account menu. */
export function PwaMenuItems() {
  const canInstall = useSyncExternalStore(subscribeInstall, () => installEvent !== null, () => false);
  const [push, setPush] = useState<"unsupported" | "off" | "on" | "blocked" | "busy">("unsupported");

  useEffect(() => {
    if (!key() || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker.getRegistration().then(async (reg) => {
      if (Notification.permission === "denied") return setPush("blocked");
      const sub = await reg?.pushManager.getSubscription();
      setPush(sub ? "on" : "off");
    });
  }, []);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    installEvent = null;
    emit();
  }

  async function togglePush() {
    const reg = await navigator.serviceWorker.ready;
    setPush("busy");
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await removePushSubscription(existing.endpoint);
      await existing.unsubscribe();
      return setPush("off");
    }
    if ((await Notification.requestPermission()) !== "granted") return setPush("blocked");
    try {
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key()! });
      const { ok } = await savePushSubscription(sub.toJSON(), navigator.userAgent);
      if (!ok) await sub.unsubscribe();
      setPush(ok ? "on" : "off");
    } catch {
      setPush("off");
    }
  }

  return (
    <>
      {canInstall && (
        <button type="button" onClick={install} className={item}>
          <Download className="size-4 text-muted" /> Install the app
        </button>
      )}
      {push !== "unsupported" && (
        <button type="button" onClick={togglePush} disabled={push === "busy" || push === "blocked"} className={item}>
          {push === "on" ? <BellOff className="size-4 text-muted" /> : <Bell className="size-4 text-muted" />}
          {push === "on"
            ? "Turn off phone notifications"
            : push === "blocked"
              ? "Notifications are blocked in this browser"
              : "Turn on phone notifications"}
        </button>
      )}
    </>
  );
}
