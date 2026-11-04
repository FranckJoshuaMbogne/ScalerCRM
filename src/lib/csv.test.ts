import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, toCsv } from "./csv";

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

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes and newlines inside quotes", () => {
    expect(parseCsv('name,notes\r\n"Rao, Asha","said ""hi""\nthen left"\r\n')).toEqual([
      ["name", "notes"],
      ["Rao, Asha", 'said "hi"\nthen left'],
    ]);
  });

  it("strips the BOM, skips blank lines and detects semicolons", () => {
    expect(parseCsv("﻿a;b\n\n1;2\n;\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("round-trips what toCsv writes", () => {
    const csv = toCsv([{ n: "₹ 1,200", f: "=SUM(A1)" }], [
      { header: "Amount", value: (r) => r.n },
      { header: "Formula", value: (r) => r.f },
    ]);
    expect(parseCsv(csv)).toEqual([
      ["Amount", "Formula"],
      ["₹ 1,200", "'=SUM(A1)"],
    ]);
  });
});
