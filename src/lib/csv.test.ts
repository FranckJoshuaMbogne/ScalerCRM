import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("quotes and neutralises formulas", () => {
    expect(csvCell('Ravi "RK" Kumar')).toBe('"Ravi ""RK"" Kumar"');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("-1500.50")).toBe("-1500.50");
    expect(csvCell("+919849012345")).toBe("'+919849012345");
    expect(csvCell(null)).toBe("");
  });

  it("builds a sheet with a header row", () => {
    expect(toCsv([{ n: "Asha", v: 10 }], [{ header: "Name", value: (r) => r.n }, { header: "Value", value: (r) => r.v }])).toBe(
      "﻿Name,Value\r\nAsha,10\r\n",
    );
  });
});
