import { describe, expect, it } from "vitest";
import { canonicalJson, parseLeadPayload, readApiKey, requestHash } from "./lead-payload";

describe("parseLeadPayload", () => {
  it("normalises the phone with the business country and keeps attribution", () => {
    const r = parseLeadPayload(
      {
        phone: "98490 12345",
        name: "Ravi",
        interest: "Sherwani",
        utm_source: "google",
        utm_campaign: "diwali",
        gclid: "abc",
        unexpected: "dropped",
      },
      "IN",
    );
    expect(r).toEqual({
      ok: true,
      input: {
        phone: "+919849012345",
        email: null,
        full_name: "Ravi",
        title: "Sherwani",
        description: null,
        campaign: "diwali",
        touch: { utm_source: "google", utm_campaign: "diwali", gclid: "abc" },
      },
    });
  });

  it("requires a valid phone or an email", () => {
    expect(parseLeadPayload({ name: "x" }, "IN")).toEqual({ ok: false, errors: { phone: "send a phone number or an email" } });
    expect(parseLeadPayload({ phone: "12345" }, "IN")).toEqual({ ok: false, errors: { phone: "phone is not a valid number" } });
    expect(parseLeadPayload({ email: "not-an-email" }, "IN")).toMatchObject({ ok: false, errors: { email: expect.any(String) } });
    expect(parseLeadPayload({ email: "A@B.com" }, "IN")).toMatchObject({ ok: true, input: { email: "a@b.com", phone: null } });
  });

  it("only accepts source keys", () => {
    expect(parseLeadPayload({ email: "a@b.com", source: "Meta Ads" }, "IN")).toMatchObject({ ok: false });
    expect(parseLeadPayload({ email: "a@b.com", source: "meta_ads" }, "IN")).toMatchObject({ ok: true, input: { source: "meta_ads" } });
  });
});

describe("requestHash", () => {
  it("ignores key order", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(requestHash({ a: 1, b: 2 })).toBe(requestHash({ b: 2, a: 1 }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
  });
});

describe("readApiKey", () => {
  it("reads bearer or x-api-key", () => {
    expect(readApiKey(new Headers({ authorization: "Bearer sk_live_abc" }))).toBe("sk_live_abc");
    expect(readApiKey(new Headers({ "x-api-key": "sk_live_def" }))).toBe("sk_live_def");
    expect(readApiKey(new Headers())).toBeNull();
  });
});
