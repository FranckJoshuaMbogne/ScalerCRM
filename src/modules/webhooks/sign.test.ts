import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "./sign";
import { VERIFY_SAMPLE_NODE } from "./samples";

const secret = "whsec_test_0123456789abcdef";
const body = JSON.stringify({ id: "evt_1", type: "order.stage_changed", data: { order: { id: "o1" } } });

describe("webhook signatures", () => {
  it("verify with our own check", () => {
    const now = 1_800_000_000;
    const header = signPayload(secret, body, now);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifySignature(secret, body, header, now + 10)).toBe(true);
    expect(verifySignature(secret, body + " ", header, now)).toBe(false);
    expect(verifySignature("whsec_other", body, header, now)).toBe(false);
    expect(verifySignature(secret, body, header, now + 301)).toBe(false);
    expect(verifySignature(secret, body, "t=abc,v1=00", now)).toBe(false);
    expect(verifySignature(secret, body, null, now)).toBe(false);
  });

  it("verify with the published Node sample", () => {
    const require = createRequire(import.meta.url);
    const verify = new Function("require", `${VERIFY_SAMPLE_NODE}\nreturn verifyScalerSignature;`)(require) as (
      rawBody: string,
      header: string,
      secret: string,
    ) => boolean;
    const header = signPayload(secret, body, Math.floor(Date.now() / 1000));
    expect(verify(body, header, secret)).toBe(true);
    expect(verify(body.replace("o1", "o2"), header, secret)).toBe(false);
    expect(verify(body, header, "whsec_wrong")).toBe(false);
    expect(verify(body, signPayload(secret, body, Math.floor(Date.now() / 1000) - 3600), secret)).toBe(false);
  });
});
