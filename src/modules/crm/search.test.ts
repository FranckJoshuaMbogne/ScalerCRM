import { describe, expect, it } from "vitest";
import { parseSearch } from "./search";

describe("parseSearch", () => {
  it("strips filter syntax from user input", () => {
    expect(parseSearch("ravi,or(id.eq.1)")?.text).toBe("ravi or id.eq.1");
    expect(parseSearch("  %%  ")).toBeNull();
  });

  it("recognises phone numbers in any format", () => {
    expect(parseSearch("98490 12345")).toMatchObject({ phone: "+919849012345", digits: "9849012345" });
    expect(parseSearch("98490")).toMatchObject({ phone: null, digits: "98490" });
    expect(parseSearch("CIF-000012")).toMatchObject({ phone: null, digits: null, text: "CIF-000012" });
  });
});
