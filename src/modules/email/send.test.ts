import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { senderFor } = await import("./send");

describe("email sender", () => {
  const scaler = "SCALER <noreply@scalercrm.com>";

  it("uses the business's verified domain", () => {
    expect(senderFor({ name: "Alpha CRM", address: "team@alpha.in" }, scaler)).toBe('"Alpha CRM" <team@alpha.in>');
  });

  it("falls back to SCALER's address under the business's name", () => {
    expect(senderFor({ name: "Alpha CRM", address: null }, scaler)).toBe('"Alpha CRM" <noreply@scalercrm.com>');
    expect(senderFor({ name: "Alpha", address: null }, "noreply@scalercrm.com")).toBe('"Alpha" <noreply@scalercrm.com>');
  });

  it("keeps SCALER's sender when there is no business", () => {
    expect(senderFor(null, scaler)).toBe(scaler);
  });

  it("can't be used to inject headers", () => {
    expect(senderFor({ name: 'Evil"\r\nBcc: x@y.z <', address: null }, scaler)).toBe('"EvilBcc: x@y.z " <noreply@scalercrm.com>');
  });
});
