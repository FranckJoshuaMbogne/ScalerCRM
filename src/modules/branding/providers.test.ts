import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { forTests, manualInstructions } = await import("./providers");

describe("domain providers", () => {
  it("tell people which DNS record to add", () => {
    expect(manualInstructions("crm.brand.in")).toEqual([{ type: "CNAME", name: "crm", value: "cname.vercel-dns.com" }]);
    expect(manualInstructions("brand.in")).toEqual([{ type: "A", name: "@", value: "76.76.21.21" }]);
  });

  it("call a domain active only when verified and pointing at us", () => {
    expect(forTests.fromVercel("crm.brand.in", { verified: true }, false).status).toBe("active");
    expect(forTests.fromVercel("crm.brand.in", { verified: true }, true).status).toBe("pending");
    const pending = forTests.fromVercel("crm.brand.in", { verified: false, verification: [{ type: "TXT", domain: "_vercel.brand.in", value: "vc-domain-verify=x" }] }, null);
    expect(pending.status).toBe("pending");
    expect(pending.instructions).toContainEqual({ type: "TXT", name: "_vercel.brand.in", value: "vc-domain-verify=x" });
  });

  it("read Resend's verdict on a sender domain", () => {
    expect(forTests.fromResend({ id: "d1", status: "verified", records: [] })).toMatchObject({ providerId: "d1", status: "verified" });
    expect(forTests.fromResend({ id: "d1", status: "not_started", records: [{ type: "TXT", name: "resend._domainkey", value: "p=x" }] }).records).toHaveLength(1);
    expect(forTests.fromResend({ status: "temporary_failure" }).status).toBe("failed");
  });
});
