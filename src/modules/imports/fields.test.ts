import { describe, expect, it } from "vitest";
import { detectColumns, type Lookups, parseAmount, parseDate, parsePaymentMethod } from "./fields";
import { buildRows } from "./rows";

const lookups: Lookups = {
  branches: [{ id: "b1", name: "Bandra" }],
  sources: [{ id: "s1", key: "walk_in", name: "Walk-in" }],
  leadStages: [
    { id: "st-new", key: "new", name: "New", category: "open" },
    { id: "st-won", key: "won", name: "Converted", category: "won" },
  ],
  lostReasons: [{ id: "lr1", name: "Price too high" }],
  orderStages: [{ id: "os-del", key: "delivered", name: "Delivered" }],
  members: [{ id: "u1", name: "Sam Sales", email: "sam@shop.in" }],
};

describe("import parsing", () => {
  it("recognises common header spellings", () => {
    expect(detectColumns("customers", ["Customer Name", "Mobile No.", "E-mail", "DOB"])).toEqual({
      full_name: 0, phone: 1, email: 2, date_of_birth: 3,
    });
  });

  it("reads Indian and ISO dates as that calendar day", () => {
    expect(parseDate("05/03/2024")).toBe("2024-03-05T12:00:00Z");
    expect(parseDate("2024-03-05")).toBe("2024-03-05T12:00:00Z");
    expect(parseDate("31/02/2024")).toBeNull();
    expect(parseDate(" ")).toBeUndefined();
  });

  it("reads rupee amounts with Indian grouping", () => {
    expect(parseAmount("₹1,20,000.50")).toBe("120000.50");
    expect(parseAmount("Rs. 500")).toBe("500");
    expect(parseAmount("abc")).toBeNull();
  });

  it("maps payment modes", () => {
    expect(parsePaymentMethod("GPay")).toBe("upi");
    expect(parsePaymentMethod("Debit card")).toBe("card");
    expect(parsePaymentMethod("NEFT")).toBe("bank_transfer");
    expect(parsePaymentMethod("")).toBe("other");
  });

  it("normalises phones to E.164 and resolves names to ids", () => {
    const { rows, problems } = buildRows("leads", [
      ["Lead No", "Name", "Mobile", "Source", "Status", "Owner", "Value", "Enquiry date"],
      ["MPF-1", "Asha", "98200 12345", "walk in", "converted", "sam@shop.in", "12,500", "05/03/2024"],
    ], lookups, "IN");
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({
      row: 1, external_ref: "MPF-1", phone: "+919820012345", source_id: "s1", status_id: "st-won",
      owner_id: "u1", expected_value: "12500", created_at: "2024-03-05T12:00:00Z",
    });
  });

  it("lists every problem in a row and leaves the row out", () => {
    const { rows, problems } = buildRows("orders", [
      ["Order No", "Phone", "Total", "Paid", "Status", "Branch"],
      ["1", "12", "100", "500", "Shipped", "Andheri"],
      ["2", "", "100", "", "", ""],
      ["3", "9820012345", "1,000", "400", "Delivered", "bandra"],
    ], lookups, "IN");
    expect(rows.map((r) => r.row)).toEqual([3]);
    expect(problems[0].error).toContain('phone "12"');
    expect(problems[0].error).toContain("paid is more than the total");
    expect(problems[0].error).toContain('unknown stage "Shipped"');
    expect(problems[0].error).toContain('unknown branch "Andheri"');
    expect(problems[1]).toEqual({ row: 2, error: "needs a phone number or an email" });
    expect(rows[0]).toMatchObject({ stage_id: "os-del", branch_id: "b1", total: "1000", paid: "400" });
  });

  it("refuses a file without the columns it needs", () => {
    expect(buildRows("orders", [["Name", "Notes"], ["A", "B"]], lookups, "IN").missing).toEqual(["total", "phone or email"]);
  });
});
