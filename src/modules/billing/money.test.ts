import { describe, expect, it } from "vitest";
import { paiseToRupees, rupeesToPaise, sameAmount } from "./money";

describe("money", () => {
  it("converts rupees to paise without floats", () => {
    expect(rupeesToPaise("2948.82")).toBe(294882);
    expect(rupeesToPaise("0.1")).toBe(10);
    expect(rupeesToPaise("19")).toBe(1900);
    expect(rupeesToPaise(1.15)).toBe(115); // 1.15 * 100 is 114.99999… as a float
  });
  it("refuses negatives, junk and fractions of a paisa", () => {
    expect(() => rupeesToPaise("-1")).toThrow();
    expect(() => rupeesToPaise("1.234")).toThrow();
    expect(() => rupeesToPaise("abc")).toThrow();
  });
  it("converts paise back", () => {
    expect(paiseToRupees(294882)).toBe("2948.82");
    expect(paiseToRupees(5)).toBe("0.05");
    expect(() => paiseToRupees(1.5)).toThrow();
  });
  it("compares to the paisa", () => {
    expect(sameAmount("2948.8", "2948.80")).toBe(true);
    expect(sameAmount("2948.81", 2948.82)).toBe(false);
  });
});
