import { describe, expect, it } from "vitest";
import { pace, periodEnd, periodLabel, periodStart } from "./targets";

describe("target periods", () => {
  it("start on the first day of the month or quarter", () => {
    expect(periodStart("2027-06-17", "month")).toBe("2027-06-01");
    expect(periodStart("2027-06-17", "quarter")).toBe("2027-04-01");
    expect(periodStart("2027-01-05", "quarter")).toBe("2027-01-01");
    expect(periodStart("2027-12-31", "quarter")).toBe("2027-10-01");
  });

  it("end on the last day", () => {
    expect(periodEnd("2027-02-01", "month")).toBe("2027-02-28");
    expect(periodEnd("2028-02-01", "month")).toBe("2028-02-29");
    expect(periodEnd("2027-10-01", "quarter")).toBe("2027-12-31");
  });

  it("are named as people say them (financial-year quarters)", () => {
    expect(periodLabel("2027-06-01", "month")).toBe("June 2027");
    expect(periodLabel("2027-04-01", "quarter")).toBe("Q1 FY27-28");
    expect(periodLabel("2028-01-01", "quarter")).toBe("Q4 FY27-28");
  });
});

describe("pace", () => {
  it("compares progress with time gone", () => {
    expect(pace(40, 50)).toBe("on_track");
    expect(pace(20, 50)).toBe("behind");
    expect(pace(75, 50)).toBe("ahead");
    expect(pace(100, 99)).toBe("ahead");
    expect(pace(null, 50)).toBeNull();
  });
});
