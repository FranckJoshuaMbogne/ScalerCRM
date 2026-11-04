/**
 * Dates for tasks, in the business's time zone. Pure: no clock reads, so it is unit tested.
 * Browsers send datetime-local values without a zone; they are read as business-local time.
 */

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function zonedParts(date: Date, timeZone: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second };
}

/** Minutes the zone is ahead of UTC at this instant (IST → 330). */
export function offsetMinutes(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Wall-clock time in a zone → the instant. Handles DST shifts by re-checking the offset. */
export function fromZoned(p: Omit<Parts, "second"> & { second?: number }, timeZone: string): Date {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second ?? 0);
  let at = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  const second = guess - offsetMinutes(new Date(at), timeZone) * 60000;
  if (second !== at) at = second;
  return new Date(at);
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "2026-12-15T10:30" (datetime-local) read in the business zone. Null if malformed. */
export function parseLocalInput(value: string, timeZone: string): Date | null {
  const m = LOCAL_INPUT.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const d = fromZoned({ year, month, day, hour, minute }, timeZone);
  // Reject impossible dates such as 31 February, which Date.UTC would roll over.
  const back = zonedParts(d, timeZone);
  return back.day === day && back.month === month ? d : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Instant → "YYYY-MM-DDTHH:mm" in the business zone, for datetime-local inputs. */
export function toLocalInput(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Start of the local day containing `date`, shifted by `addDays`. */
export function startOfDay(date: Date, timeZone: string, addDays = 0) {
  const p = zonedParts(date, timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + addDays));
  return fromZoned(
    { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour: 0, minute: 0 },
    timeZone,
  );
}

function atLocal(date: Date, timeZone: string, addDays: number, hour: number) {
  const day = startOfDay(date, timeZone, addDays);
  const p = zonedParts(day, timeZone);
  return fromZoned({ year: p.year, month: p.month, day: p.day, hour, minute: 0 }, timeZone);
}

export const FOLLOW_UP_PRESETS = ["1h", "evening", "tomorrow", "3d", "week"] as const;
export type FollowUpPreset = (typeof FOLLOW_UP_PRESETS)[number];

/** Quick follow-up times, offered as one-tap buttons on phones. */
export function followUpPresets(now: Date, timeZone: string): { key: FollowUpPreset; label: string; at: Date }[] {
  const hour = zonedParts(now, timeZone).hour;
  const list: { key: FollowUpPreset; label: string; at: Date }[] = [
    { key: "1h", label: "In 1 hour", at: new Date(Math.ceil((now.getTime() + 3600_000) / 300_000) * 300_000) },
  ];
  if (hour < 17) list.push({ key: "evening", label: "This evening, 6 pm", at: atLocal(now, timeZone, 0, 18) });
  list.push(
    { key: "tomorrow", label: "Tomorrow, 10 am", at: atLocal(now, timeZone, 1, 10) },
    { key: "3d", label: "In 3 days, 10 am", at: atLocal(now, timeZone, 3, 10) },
    { key: "week", label: "Next week, 10 am", at: atLocal(now, timeZone, 7, 10) },
  );
  return list;
}

export function resolvePreset(key: string, now: Date, timeZone: string): Date | null {
  return followUpPresets(now, timeZone).find((p) => p.key === key)?.at ?? null;
}

export type Bucket = "overdue" | "today" | "upcoming";

/** Where an open task sits in "My day". */
export function bucketFor(dueAt: Date, now: Date, timeZone: string): Bucket {
  if (dueAt.getTime() < now.getTime()) return "overdue";
  return dueAt.getTime() < startOfDay(now, timeZone, 1).getTime() ? "today" : "upcoming";
}

/** "Today 4:30 pm", "Tomorrow 10:00 am", "Mon 15 Dec, 10:00 am", "3 h overdue". */
export function describeDue(dueAt: Date, now: Date, timeZone: string) {
  const time = new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit" }).format(dueAt);
  const diff = now.getTime() - dueAt.getTime();
  if (diff > 0) {
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${Math.max(1, mins)} min overdue`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h overdue`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} overdue`;
  }
  const today = startOfDay(now, timeZone).getTime();
  const t = dueAt.getTime();
  if (t < startOfDay(now, timeZone, 1).getTime() && t >= today) return `Today ${time}`;
  if (t < startOfDay(now, timeZone, 2).getTime()) return `Tomorrow ${time}`;
  const date = new Intl.DateTimeFormat("en-IN", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(dueAt);
  return `${date}, ${time}`;
}
