/**
 * Plan limits as the app shows them. The database enforces them
 * (supabase/migrations/*_plans_limits_platform.sql); this file only labels.
 */
export const LIMITS = [
  { key: "max_users", label: "Active users", period: null },
  { key: "max_branches", label: "Branches", period: null },
  { key: "max_whatsapp_numbers", label: "WhatsApp numbers", period: null },
  { key: "monthly_messages", label: "Template messages", period: "this month" },
  { key: "max_automations", label: "Active automations", period: null },
  { key: "daily_api_calls", label: "API calls", period: "today" },
] as const;

export type LimitKey = (typeof LIMITS)[number]["key"];
export type Limits = Partial<Record<LimitKey, number | null>>;

export type UsageRow = {
  key: LimitKey;
  label: string;
  period: string | null;
  used: number;
  limit: number | null;
  /** 0–100, null when unlimited. */
  percent: number | null;
  level: "ok" | "near" | "full";
};

export function usageRows(limits: Limits, usage: Partial<Record<LimitKey, number>>): UsageRow[] {
  return LIMITS.map((l) => {
    const used = Number(usage[l.key] ?? 0);
    const limit = limits[l.key] ?? null;
    const percent = limit === null ? null : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
    const level = percent === null ? "ok" : percent >= 100 ? "full" : percent >= 80 ? "near" : "ok";
    return { key: l.key, label: l.label, period: l.period, used, limit, percent, level };
  });
}

const SENTENCES: Record<LimitKey, (n: number) => string> = {
  max_users: (n) => `Your plan allows ${n} active users. Remove someone or move to a bigger plan to add more.`,
  max_branches: (n) => `Your plan allows ${n} ${n === 1 ? "branch" : "branches"}. Move to a bigger plan to add another.`,
  max_whatsapp_numbers: (n) => `Your plan allows ${n} WhatsApp ${n === 1 ? "number" : "numbers"}. Disconnect one or move to a bigger plan.`,
  monthly_messages: (n) =>
    `This would go over your plan's ${n.toLocaleString("en-IN")} template messages this month. Send to fewer people, wait for next month or move to a bigger plan.`,
  max_automations: (n) => `Your plan allows ${n} active automations. Switch one off or move to a bigger plan.`,
  daily_api_calls: (n) => `Your plan allows ${n.toLocaleString("en-IN")} API calls a day.`,
};

/** "plan limit reached: max_users (limit 5)" → a sentence people can act on. */
export function limitMessage(dbMessage: string): string | null {
  const m = dbMessage.match(/plan limit reached: ([a-z_]+) \(limit (\d+)\)/);
  if (!m || !(m[1] in SENTENCES)) return null;
  return SENTENCES[m[1] as LimitKey](Number(m[2]));
}
