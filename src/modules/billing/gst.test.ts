import { describe, expect, it } from "vitest";
import { isValidGstin, normaliseGstin, stateName } from "./gst";

describe("GSTIN", () => {
  it("accepts a valid GSTIN, however it was typed", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin(" 27aapfu0939f1zv ")).toBe(true);
    expect(normaliseGstin("27 aapfu 0939f1zv")).toBe("27AAPFU0939F1ZV");
  });
  it("rejects a wrong check digit, shape or state", () => {
    expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false);
    expect(isValidGstin("27AAPFU0939F1Z")).toBe(false);
    expect(isValidGstin("99AAPFU0939F1ZV")).toBe(false);
  });
  it("names states", () => {
    expect(stateName("27")).toBe("Maharashtra");
    expect(stateName(null)).toBe("—");
  });
});
