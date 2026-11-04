import { describe, expect, it } from "vitest";
import { renderOutboxEmail } from "@/modules/email/templates";

const base = { business_name: "Lambda <Linen>", timezone: "Asia/Kolkata", path: "/settings/billing" };

describe("billing emails", () => {
  it("renders every template the database queues", () => {
    for (const t of ["trial_ending", "trial_ended", "payment_failed", "grace_ending", "read_only", "cancelled", "downgrade_blocked", "invoice"]) {
      const email = renderOutboxEmail(`billing_${t}`, { ...base, grace_ends_at: "2027-05-01T10:00:00Z", trial_ends_at: "2027-05-01T10:00:00Z", number: "SCL/27-28/00001", total: 2948.82, currency: "INR", invoice_id: "abc" }, "https://app.test");
      expect(email, t).not.toBeNull();
      expect(email!.html).not.toContain("<Linen>");
      expect(email!.text).toContain("https://app.test/");
    }
  });

  it("says when an invoice is only a test", () => {
    const email = renderOutboxEmail("billing_invoice", { ...base, number: "TEST/27-28/00001", total: "2948.82", test_mode: true, invoice_id: "abc" }, "https://app.test")!;
    expect(email.subject).toContain("Test invoice TEST/27-28/00001");
    expect(email.text).toContain("not a tax invoice");
    expect(email.text).toContain("https://app.test/settings/billing/invoices/abc");
  });

  it("leaves unknown templates to fail", () => {
    expect(renderOutboxEmail("billing_nope", base, "https://app.test")).toBeNull();
  });
});
