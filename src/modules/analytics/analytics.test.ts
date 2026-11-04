import { describe, expect, it } from "vitest";
import { change, formatMetric, METRICS } from "./metrics";
import { daysBetween, previousPeriod, resolvePeriod } from "./period";

describe("periods", () => {
  it("resolves presets in local days", () => {
    expect(resolvePeriod({ preset: "7d" }, "2027-03-10")).toMatchObject({ from: "2027-03-04", to: "2027-03-10" });
    expect(resolvePeriod({}, "2027-03-10")).toMatchObject({ from: "2027-02-09", to: "2027-03-10" });
    expect(resolvePeriod({ preset: "month" }, "2027-03-10")).toMatchObject({ from: "2027-03-01", to: "2027-03-10" });
    expect(resolvePeriod({ preset: "last_month" }, "2027-03-10")).toMatchObject({ from: "2027-02-01", to: "2027-02-28" });
    expect(resolvePeriod({ from: "2027-01-01", to: "2027-01-31" }, "2027-03-10")).toMatchObject({ from: "2027-01-01", to: "2027-01-31" });
    expect(resolvePeriod({ from: "2027-02-01", to: "2027-01-01" }, "2027-03-10").label).toBe("Last 30 days");
  });

  it("compares with the period just before, of the same length", () => {
    const p = { from: "2027-03-01", to: "2027-03-10", label: "" };
    expect(previousPeriod(p)).toMatchObject({ from: "2027-02-19", to: "2027-02-28" });
    expect(daysBetween("2027-02-19", "2027-02-28")).toBe(10);
  });
});

describe("metrics", () => {
  it("defines every metric the summary returns", () => {
    const summaryKeys = ["leads", "leads_won", "leads_lost", "conversion_rate", "walk_ins", "appointments", "no_show_rate", "orders",
      "revenue", "average_order_value", "collected", "outstanding", "spend", "median_first_reply_seconds", "tasks_overdue"];
    expect(Object.keys(METRICS).sort()).toEqual(summaryKeys.sort());
  });

  it("formats and compares", () => {
    expect(formatMetric("33.3", "percent", "INR")).toBe("33.3%");
    expect(formatMetric(125000, "money", "INR")).toBe("₹1,25,000");
    expect(formatMetric(5400, "duration", "INR")).toBe("1 h 30 min");
    expect(formatMetric(null, "count", "INR")).toBe("—");
    expect(change(120, 100)).toBe(20);
    expect(change(5, 0)).toBeNull();
  });
});

describe("scheduled report email", async () => {
  const { reportEmail } = await import("./report-email");
  it("lists the report's metrics with shared labels", () => {
    const e = reportEmail({
      report: "sales", businessName: "Pi <Couture>", currency: "INR", from: "2027-03-01", to: "2027-03-07",
      summary: { leads: 12, leads_won: 3, conversion_rate: 25, orders: 4, average_order_value: "18500.00", tasks_overdue: 2 },
      url: "https://app.example.com/analytics",
    });
    expect(e.subject).toBe("Pi <Couture>: Sales for 2027-03-01 to 2027-03-07");
    expect(e.text).toContain("Conversion: 25.0%");
    expect(e.text).toContain("Average order: ₹18,500");
    expect(e.html).toContain("Pi &lt;Couture&gt;");
  });
});
