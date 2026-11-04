/** Kanban board shaping and transition checks. Pure, so it is unit tested. */

export type BoardStatus = {
  id: string;
  name: string;
  category: "open" | "won" | "lost";
  stage: string;
  position: number;
  isActive: boolean;
  requiresOwner: boolean;
};

export type BoardLead = { id: string; statusId: string; expectedValue: string | null; ownerId: string | null };

export type Transitions = Record<string, string[]>;

/** Sum of numeric(14,2) strings without floating-point error. */
export function sumMoney(values: (string | null)[]): string {
  let paise = BigInt(0);
  for (const v of values) {
    if (!v) continue;
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(v.trim());
    if (!m) continue;
    const n = BigInt(m[2]) * BigInt(100) + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
    paise += m[1] ? -n : n;
  }
  const neg = paise < BigInt(0);
  const abs = neg ? -paise : paise;
  const whole = abs / BigInt(100);
  const frac = (abs % BigInt(100)).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export type Column<L extends BoardLead> = {
  status: BoardStatus;
  leads: L[];
  total: string;
};

/**
 * Columns in pipeline order: every active stage, plus hidden stages that
 * still hold leads (so nothing disappears from the board).
 */
export function buildBoard<L extends BoardLead>(statuses: BoardStatus[], leads: L[]): Column<L>[] {
  const byStatus = new Map<string, L[]>();
  for (const l of leads) {
    const list = byStatus.get(l.statusId);
    if (list) list.push(l);
    else byStatus.set(l.statusId, [l]);
  }
  return [...statuses]
    .sort((a, b) => a.position - b.position)
    .filter((s) => s.isActive || byStatus.has(s.id))
    .map((status) => {
      const list = byStatus.get(status.id) ?? [];
      return { status, leads: list, total: sumMoney(list.map((l) => l.expectedValue)) };
    });
}

export type MoveCheck = { ok: true; needsLostReason: boolean } | { ok: false; reason: string };

/** Mirrors the database rules so the board can refuse a drop before calling the server. */
export function checkMove(
  lead: Pick<BoardLead, "statusId" | "ownerId">,
  to: BoardStatus,
  transitions: Transitions,
  name: (id: string) => string,
): MoveCheck {
  if (lead.statusId === to.id) return { ok: false, reason: "The lead is already in this stage." };
  if (!to.isActive) return { ok: false, reason: `${to.name} is no longer in use.` };
  const allowed = transitions[lead.statusId];
  if (allowed?.length && !allowed.includes(to.id)) {
    return { ok: false, reason: `Leads in ${name(lead.statusId)} can't move to ${to.name}.` };
  }
  if (to.requiresOwner && !lead.ownerId) {
    return { ok: false, reason: `Assign the lead to someone before moving it to ${to.name}.` };
  }
  return { ok: true, needsLostReason: to.category === "lost" };
}

/** Moves one id up or down in an ordered list (for reordering stages, sources and reasons). */
export function moveId(ids: string[], id: string, direction: "up" | "down"): string[] {
  const i = ids.indexOf(id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** A machine key from a name that doesn't clash with existing keys: "Fitting booked" → "fitting_booked_2". */
export function uniqueKey(name: string, taken: Iterable<string>) {
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "stage";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}
