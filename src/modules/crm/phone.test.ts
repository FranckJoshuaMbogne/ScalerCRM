import { describe, expect, it } from "vitest";
import { normalisePhone } from "./phone";

describe("normalisePhone", () => {
  it("normalises Indian numbers written different ways to one key", () => {
    const forms = ["98490 12345", "+91 98490 12345", "09849012345", "0091-9849012345"];
    for (const f of forms) expect(normalisePhone(f)).toBe("+919849012345");
  });

  it("keeps foreign numbers with explicit country code", () => {
    expect(normalisePhone("+1 (214) 555-0142")).toBe("+12145550142");
  });

  it("uses the business default country", () => {
    expect(normalisePhone("(214) 555-0142", "US")).toBe("+12145550142");
  });

  it("rejects invalid or empty input", () => {
    expect(normalisePhone("12345")).toBeNull();
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone("not a phone")).toBeNull();
  });
});
