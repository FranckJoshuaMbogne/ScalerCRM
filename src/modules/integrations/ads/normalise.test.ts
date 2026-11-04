import { describe, expect, it } from "vitest";
import { fromGoogleAds, fromMetaInsights, microsToAmount } from "./normalise";

describe("ad spend normalisation", () => {
  it("converts Google micros exactly", () => {
    expect(microsToAmount("1234560000")).toBe("1234.56");
    expect(microsToAmount("1234565000")).toBe("1234.57");
    expect(microsToAmount(0)).toBe("0.00");
  });

  it("reads Meta insights", () => {
    expect(
      fromMetaInsights([
        { campaign_id: "c-1", campaign_name: "Diwali FB", date_start: "2027-02-01", spend: "1000.50", impressions: "20000", clicks: "300",
          actions: [{ action_type: "lead", value: "12" }, { action_type: "link_click", value: "280" }] },
      ]),
    ).toEqual([{ campaign_id: "c-1", campaign_name: "Diwali FB", status: null, day: "2027-02-01", spend: "1000.50", impressions: "20000", clicks: "300", leads: "12" }]);
  });

  it("reads Google Ads results", () => {
    expect(
      fromGoogleAds([
        { campaign: { id: "77", name: "Search brand", status: "ENABLED" }, segments: { date: "2027-02-01" },
          metrics: { costMicros: "499990000", impressions: "1000", clicks: "80", conversions: 4.6 } },
      ]),
    ).toEqual([{ campaign_id: "77", campaign_name: "Search brand", status: "ENABLED", day: "2027-02-01", spend: "499.99", impressions: "1000", clicks: "80", leads: "5" }]);
  });
});
