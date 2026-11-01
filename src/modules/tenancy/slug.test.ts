import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/forms";
import { roleKey, SLUG_PATTERN, slugify } from "./slug";

describe("slugify", () => {
  it("builds a valid web address from a business name", () => {
    expect(slugify("My Perfect Fit")).toBe("my-perfect-fit");
    expect(slugify("  Mudraa Design Studio — Milpitas ")).toBe("mudraa-design-studio-milpitas");
    expect(slugify("Café & Co.")).toBe("cafe-and-co");
  });

  it("always matches the database constraint", () => {
    for (const name of ["A--B", "---x---", "Ünïcödé Tailors", "x".repeat(80) + " y"]) {
      const slug = slugify(name);
      if (slug.length >= 3) expect(slug).toMatch(SLUG_PATTERN);
      expect(slug.length).toBeLessThanOrEqual(48);
    }
  });
});

describe("roleKey", () => {
  it("makes underscore keys", () => {
    expect(roleKey("Senior Stylist")).toBe("senior_stylist");
    expect(roleKey("!!!")).toBe("custom_role");
  });
});

describe("safeNext", () => {
  it("allows only same-site paths", () => {
    expect(safeNext("/team")).toBe("/team");
    expect(safeNext("//evil.com")).toBe("/dashboard");
    expect(safeNext("https://evil.com")).toBe("/dashboard");
    expect(safeNext("/\\evil.com")).toBe("/dashboard");
    expect(safeNext(null, "/onboarding")).toBe("/onboarding");
  });
});
