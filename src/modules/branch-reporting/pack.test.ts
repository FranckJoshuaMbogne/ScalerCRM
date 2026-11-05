import { describe, expect, it } from "vitest";
import { type Pack, packEmail, packFiles, packSectionCsv } from "./pack";

const pack: Pack = {
  kind: "pack_branch",
  from: "2027-06-01",
  to: "2027-06-07",
  summary: { leads: 12, leads_won: 3, conversion_rate: 25, orders: 2, revenue: "24000.00", collected: "9000.00" },
  branches: [{ branch_name: "Central", leads: 12, won: 3, performance_index: 1.2, revenue: "24000.00" }],
  targets: [{ branch_name: "Central", metric: "conversions", percent: 60, expected_percent: 23, target: 5, actual: 3 }],
  team: [{ owner_name: "=Asha", leads: 12, won: 3 }],
  transfers: [],
};

describe("report packs", () => {
  it("become one CSV per section that has rows", () => {
    const files = packFiles(pack);
    expect(files.map((f) => f.filename)).toEqual([
      "summary_2027-06-01_to_2027-06-07.csv",
      "branches_2027-06-01_to_2027-06-07.csv",
      "targets_2027-06-01_to_2027-06-07.csv",
      "salespeople_2027-06-01_to_2027-06-07.csv",
    ]);
    expect(packSectionCsv(pack, "targets")).toContain("Central,Conversions,,,5,3,60,23");
  });

  it("keep spreadsheet formulas out", () => {
    expect(packSectionCsv(pack, "salespeople")).toContain("'=Asha");
  });

  it("email the headline figures and link to the printable pack", () => {
    const e = packEmail(pack, { businessName: "Sigma", currency: "INR", url: "https://app.example.com/analytics/pack?x", branchName: "Central" });
    expect(e.subject).toBe("Branch manager pack: Sigma · Central, 2027-06-01 to 2027-06-07");
    expect(e.text).toContain("Central · Conversions: 60% of target (23% of the period gone)");
    expect(e.text).toContain("https://app.example.com/analytics/pack?x");
  });
});
