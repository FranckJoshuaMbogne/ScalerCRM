import { describe, expect, it } from "vitest";
import { documentTotals, fromPaise, lineAmounts, paymentState, toScaled } from "./money";

describe("order money", () => {
  it("parses decimals without floats", () => {
    expect(toScaled("1250.5", 2)).toBe(BigInt(125050));
    expect(toScaled("1,500", 2)).toBe(BigInt(150000));
    expect(toScaled("1.2345", 2)).toBeNull();
    expect(toScaled("abc", 2)).toBeNull();
    expect(fromPaise(BigInt(-5))).toBe("-0.05");
  });

  it("matches the database's line maths", () => {
    // Same lines as supabase/tests/50_orders_appointments.sql
    const a = lineAmounts({ quantity: "2", unitPrice: "1250.50", discount: "100", taxRate: "5" })!;
    expect([a.gross, a.tax, a.total].map(fromPaise)).toEqual(["2501.00", "120.05", "2521.05"]);
    const b = lineAmounts({ quantity: "1.5", unitPrice: "999.99" })!;
    expect(fromPaise(b.gross)).toBe("1499.99"); // 1499.985 rounds half up
    expect(
      documentTotals([
        { quantity: "2", unitPrice: "1250.50", discount: "100", taxRate: "5" },
        { quantity: "1.5", unitPrice: "999.99" },
      ]),
    ).toEqual({ subtotal: "4000.99", discount: "100.00", tax: "120.05", total: "4021.04" });
  });

  it("totals the revised quotation from the SQL tests", () => {
    expect(
      documentTotals([
        { quantity: "1", unitPrice: "20000", discount: "2000", taxRate: "12" },
        { quantity: "1", unitPrice: "1500" },
      ]).total,
    ).toBe("21660.00");
  });

  it("labels payment state", () => {
    expect(paymentState("100.00", "0")).toBe("unpaid");
    expect(paymentState("100.00", "40.00")).toBe("partial");
    expect(paymentState("100.00", "100.00")).toBe("paid");
    expect(paymentState("100.00", "120.00")).toBe("overpaid");
  });
});
