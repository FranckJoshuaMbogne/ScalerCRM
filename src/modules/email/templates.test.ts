import { describe, expect, it } from "vitest";
import { escapeHtml, invitationEmail, renderOutboxEmail, taskReminderEmail } from "./templates";

const payload = {
  business_name: "My Perfect Fit",
  timezone: "Asia/Kolkata",
  task_title: "Call about <fabric>",
  task_type: "call",
  due_at: "2026-12-15T05:00:00Z",
  lead_number: "L-000042",
  customer_name: "Ravi Kumar",
  customer_phone: "+919849012345",
  path: "/leads/abc",
};

describe("task reminder email", () => {
  it("shows the due time in the business time zone", () => {
    const e = taskReminderEmail(payload, "https://app.example.com");
    expect(e.subject).toMatch(/^Call due 15 Dec 2026, 10:30\sam: Call about <fabric>$/i);
    expect(e.text).toContain("Customer: L-000042 · Ravi Kumar (+919849012345)");
    expect(e.text).toContain("https://app.example.com/leads/abc");
  });

  it("escapes user text in HTML", () => {
    const e = taskReminderEmail(payload, "https://app.example.com");
    expect(e.html).toContain("Call about &lt;fabric&gt;");
    expect(e.html).not.toContain("<fabric>");
  });

  it("never links off-site from a stored path", () => {
    const e = taskReminderEmail({ ...payload, path: "https://evil.example" }, "https://app.example.com");
    expect(e.text).toContain("https://app.example.com/tasks");
  });
});

describe("invitation email", () => {
  it("names the business, role and link", () => {
    const e = invitationEmail({ businessName: "Delta", inviterName: "Hana", roleName: "Sales executive", link: "https://x/invite/t" });
    expect(e.subject).toBe("Hana invited you to Delta on SCALER");
    expect(e.text).toContain("https://x/invite/t");
    expect(e.html).toContain('href="https://x/invite/t"');
  });
});

describe("appointment reminder email", () => {
  it("names the customer, time and branch", () => {
    const e = renderOutboxEmail(
      "appointment_reminder",
      { kind: "trial", starts_at: "2026-12-15T05:00:00Z", timezone: "Asia/Kolkata", customer_name: "Sita",
        customer_phone: "+919811100002", branch_name: "Banjara Hills", path: "/appointments?date=2026-12-15" },
      "https://app.example.com",
    )!;
    expect(e.subject).toMatch(/^Trial with Sita at 15 Dec 2026, 10:30\sam$/i);
    expect(e.text).toContain("Banjara Hills");
    expect(e.text).toContain("https://app.example.com/appointments?date=2026-12-15");
  });
});

describe("outbox rendering", () => {
  it("returns null for unknown templates", () => {
    expect(renderOutboxEmail("nope", {}, "https://x")).toBeNull();
    expect(escapeHtml(`"a" & 'b'`)).toBe("&quot;a&quot; &amp; &#39;b&#39;");
  });
});

describe("webhook switched-off email", () => {
  it("names the endpoint, the error and links to the delivery log", () => {
    const e = renderOutboxEmail(
      "webhook_disabled",
      { business_name: "Pi Tailors", url: "https://erp.example.com/in", last_error: "HTTP 503", path: "/settings/webhooks/abc" },
      "https://app.example.com",
    )!;
    expect(e.subject).toBe("Webhook switched off for Pi Tailors");
    expect(e.text).toContain("https://erp.example.com/in");
    expect(e.text).toContain("HTTP 503");
    expect(e.text).toContain("https://app.example.com/settings/webhooks/abc");
  });
});

describe("workflow email", () => {
  it("sends the business's words, escaped, with line breaks", () => {
    const e = renderOutboxEmail(
      "automation_email",
      { subject: "Welcome, Neha", body: "Your fitting is booked.\n\nSee you <soon>!", business_name: "Omega Outfitters" },
      "https://app.example.com",
    )!;
    expect(e.subject).toBe("Welcome, Neha");
    expect(e.html).toContain("See you &lt;soon&gt;!");
    expect(e.text).toContain("Sent by Omega Outfitters.");
    expect(renderOutboxEmail("automation_email", { subject: "", body: "x" }, "https://x")).toBeNull();
  });
});
