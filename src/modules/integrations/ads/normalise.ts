/** Converting ad platform reports into spend rows. Pure; money stays exact. */

export type SpendRow = {
  campaign_id: string;
  campaign_name: string;
  status: string | null;
  day: string;
  spend: string;
  impressions: string;
  clicks: string;
  leads: string;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Google reports cost in micros (1/1,000,000 of the currency): 1234560000 → "1234.56". */
export function microsToAmount(micros: string | number | null | undefined) {
  const n = BigInt(String(micros ?? "0").replace(/\..*$/, "") || "0");
  const cents = (n + BigInt(5000)) / BigInt(10000); // round half up to 2 decimals
  return `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}

/** Meta Insights rows (level=campaign, time_increment=1). */
export function fromMetaInsights(rows: unknown[]): SpendRow[] {
  return rows.map((r) => {
    const x = obj(r);
    const leads = arr(x.actions)
      .map(obj)
      .filter((a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped")
      .reduce((n, a) => Math.max(n, Number(a.value ?? 0)), 0);
    return {
      campaign_id: String(x.campaign_id ?? ""),
      campaign_name: String(x.campaign_name ?? ""),
      status: null,
      day: String(x.date_start ?? ""),
      spend: String(x.spend ?? "0"),
      impressions: String(x.impressions ?? "0"),
      clicks: String(x.clicks ?? "0"),
      leads: String(leads),
    };
  });
}

/** Google Ads API search results (campaign, segments.date, metrics). */
export function fromGoogleAds(results: unknown[]): SpendRow[] {
  return results.map((r) => {
    const x = obj(r);
    const c = obj(x.campaign);
    const m = obj(x.metrics);
    return {
      campaign_id: String(c.id ?? ""),
      campaign_name: String(c.name ?? ""),
      status: c.status ? String(c.status) : null,
      day: String(obj(x.segments).date ?? ""),
      spend: microsToAmount(m.costMicros as string),
      impressions: String(m.impressions ?? "0"),
      clicks: String(m.clicks ?? "0"),
      leads: String(Math.round(Number(m.conversions ?? 0))),
    };
  });
}
