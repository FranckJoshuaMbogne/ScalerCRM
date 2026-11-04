import { describe, expect, it } from "vitest";
import { formatBytes, formatMoney, formatPhone } from "./format";

describe("format", () => {
  it("formats money from decimal strings", () => {
    expect(formatMoney("45000.50", "INR")).toBe("₹45,000.50");
    expect(formatMoney(null, "INR")).toBe("—");
  });
  it("groups Indian mobile numbers", () => {
    expect(formatPhone("+919849012345")).toBe("+91 98490 12345");
    expect(formatPhone("+12145550142")).toBe("+12145550142");
  });
  it("formats sizes", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
