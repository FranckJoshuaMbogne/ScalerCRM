import { describe, expect, it } from "vitest";
import { parseSettlementCsv, reconcile } from "./reconcile";

const csv = `entity_id,type,amount,fee,tax,settlement_id
pay_1,payment,2948.82,59.00,10.62,setl_1
pay_2,payment,"1,179.82",23.60,4.25,setl_1
rfnd_1,refund,100.00,0,0,setl_1
pay_3,payment,999.00,20.00,3.60,setl_1
pay_4,payment,abc,0,0,setl_1`;

describe("settlement reconciliation", () => {
  it("reads payments from a Razorpay settlement report", () => {
    const { rows } = parseSettlementCsv(csv);
    expect(rows.map((r) => r.paymentId)).toEqual(["pay_1", "pay_2", "pay_3", "pay_4"]);
    expect(rows[1]!.amount).toBe("1179.82");
  });

  it("needs the payment id and amount", () => {
    expect(parseSettlementCsv("id,total\n1,2").error).toBeTruthy();
  });

  it("matches every settled payment to an invoice of the same amount", () => {
    const { rows } = parseSettlementCsv(csv);
    const result = reconcile(rows, [
      { paymentId: "pay_1", number: "SCL/27-28/00001", total: 2948.82 },
      { paymentId: "pay_2", number: "SCL/27-28/00002", total: "1179.80" },
    ]);
    expect(result.matched).toBe(1);
    expect(result.mismatches).toEqual([
      { paymentId: "pay_2", settled: "1179.82", invoiced: "1179.80", problem: "amounts differ" },
      { paymentId: "pay_3", settled: "999.00", invoiced: null, problem: "no invoice for this payment" },
      { paymentId: "pay_4", settled: "abc", invoiced: null, problem: "amount isn't readable" },
    ]);
  });
});
