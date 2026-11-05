import { describe, expect, it } from "vitest";
import {
  brandManifest,
  brandStyle,
  checkHostname,
  contrastRatio,
  DEFAULT_BRAND,
  imageType,
  normaliseHost,
  readableWithWhite,
  resolveActiveBusiness,
} from "./brand";

describe("brand colours", () => {
  it("measure contrast as WCAG does (same as the database)", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(readableWithWhite("#2f6bff")).toBe(true);
    expect(readableWithWhite("#7a1f5c")).toBe(true);
    expect(readableWithWhite("#ffd400")).toBe(false);
    expect(readableWithWhite("red")).toBe(false);
  });

  it("only recolour branded businesses", () => {
    expect(brandStyle(DEFAULT_BRAND)).toEqual({});
    expect(brandStyle({ ...DEFAULT_BRAND, branded: true, primary_color: "#7a1f5c" })["--signal"]).toBe("#7a1f5c");
  });
});

describe("hostnames", () => {
  it("normalise case, port and trailing dot", () => {
    expect(normaliseHost(" CRM.Brand.in:443 ")).toBe("crm.brand.in");
    expect(normaliseHost("crm.brand.in.")).toBe("crm.brand.in");
  });

  it("accept owned domains, refuse ours and the provider's", () => {
    expect(checkHostname("crm.yourbrand.in")).toBeNull();
    expect(checkHostname("app.scalercrm.com")).toMatch(/own/);
    expect(checkHostname("x.vercel.app")).toMatch(/own/);
    expect(checkHostname("https://crm.yourbrand.in")).toMatch(/without/);
  });
});

describe("which business a request belongs to", () => {
  const memberships = [{ businessId: "a" }, { businessId: "b" }];

  it("is the domain's business on a custom domain, whatever the cookie says", () => {
    expect(resolveActiveBusiness(memberships, "b", "a")).toEqual({ business: { businessId: "b" }, mismatch: false, locked: true });
  });

  it("is nothing for someone who isn't a member there (no cross-tenant session)", () => {
    expect(resolveActiveBusiness(memberships, "z", "a")).toEqual({ business: null, mismatch: true, locked: true });
  });

  it("is the chosen business on SCALER's own domain", () => {
    expect(resolveActiveBusiness(memberships, null, "b").business).toEqual({ businessId: "b" });
    expect(resolveActiveBusiness(memberships, null, undefined).business).toEqual({ businessId: "a" });
  });
});

describe("the manifest", () => {
  it("installs with the tenant's name and icon", () => {
    const m = brandManifest({ ...DEFAULT_BRAND, branded: true, app_name: "Alpha CRM", short_name: "Alpha", icon: "abcdef1234567890" });
    expect(m.name).toBe("Alpha CRM");
    expect(m.short_name).toBe("Alpha");
    expect(m.icons?.[0].src).toBe("/brand/icon?v=abcdef123456");
  });

  it("falls back to SCALER's", () => {
    expect(brandManifest(DEFAULT_BRAND).name).toBe("SCALER CRM");
  });
});

describe("uploaded images", () => {
  it("are PNG or WebP by their bytes, never SVG", () => {
    expect(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(imageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(imageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>"))).toBeNull();
  });
});
