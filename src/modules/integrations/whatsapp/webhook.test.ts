import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWebhook, verifySignature, windowState } from "./webhook";

const sample = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "919849000000", phone_number_id: "555000111" },
            contacts: [{ profile: { name: "Meera" }, wa_id: "919900112233" }],
            messages: [
              { from: "919900112233", id: "wamid.A", timestamp: "1765779000", type: "text", text: { body: "Hello" } },
              { from: "919900112233", id: "wamid.B", timestamp: "1765779060", type: "image",
                image: { id: "media1", mime_type: "image/jpeg", sha256: "x", caption: "This one" } },
              { from: "919900112233", id: "wamid.C", timestamp: "1765779120", type: "interactive",
                interactive: { type: "button_reply", button_reply: { id: "b1", title: "Book a visit" } } },
              { from: "919900112233", id: "wamid.D", timestamp: "1765779180", type: "unsupported" },
            ],
            statuses: [
              { id: "wamid.OUT", status: "delivered", timestamp: "1765779200", recipient_id: "919900112233" },
              { id: "wamid.OUT2", status: "failed", timestamp: "1765779201", errors: [{ code: 131047, title: "Re-engagement message" }] },
              { id: "wamid.OUT3", status: "deleted", timestamp: "1765779202" },
            ],
          },
        },
      ],
    },
  ],
};

describe("webhook signature", () => {
  it("accepts the app secret's HMAC and rejects anything else", () => {
    const body = JSON.stringify(sample);
    const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    expect(verifySignature(body, sig, "s3cret")).toBe(true);
    expect(verifySignature(body + " ", sig, "s3cret")).toBe(false);
    expect(verifySignature(body, sig, "other")).toBe(false);
    expect(verifySignature(body, null, "s3cret")).toBe(false);
    expect(verifySignature(body, "sha1=abc", "s3cret")).toBe(false);
  });
});

describe("parseWebhook", () => {
  const items = parseWebhook(sample);

  it("flattens messages with the sender's profile name", () => {
    const messages = items.filter((i) => i.kind === "message");
    expect(messages.map((m) => m.externalId)).toEqual(["wamid.A", "wamid.B", "wamid.C", "wamid.D"]);
    const [text, image, button, unsupported] = messages.map((m) => m.item);
    expect(text).toMatchObject({ from: "919900112233", profileName: "Meera", body: "Hello", phoneNumberId: "555000111" });
    expect(text.sentAt).toBe("2025-12-15T06:10:00.000Z");
    expect(image).toMatchObject({ type: "image", body: "This one", media: { id: "media1", mime_type: "image/jpeg" } });
    expect(button.body).toBe("Book a visit");
    expect(unsupported.body).toBeNull();
  });

  it("keeps known delivery statuses, keyed by message and status", () => {
    const statuses = items.filter((i) => i.kind === "status");
    expect(statuses.map((s) => s.externalId)).toEqual(["wamid.OUT:delivered", "wamid.OUT2:failed"]);
    expect(statuses[1].item).toMatchObject({ status: "failed", errors: [{ code: 131047 }] });
  });

  it("ignores other objects and fields", () => {
    expect(parseWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "account_update", value: {} }] }] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });
});

describe("template status webhooks", () => {
  it("become template items keyed by WABA", () => {
    const items = parseWebhook({
      object: "whatsapp_business_account",
      entry: [{ id: "700800900", changes: [{ field: "message_template_status_update",
        value: { event: "REJECTED", message_template_id: 123, message_template_name: "diwali_offer", message_template_language: "en", reason: "INVALID_FORMAT" } }] }],
    });
    expect(items).toEqual([{ kind: "template", externalId: "tpl:123:REJECTED", phoneNumberId: "",
      item: { wabaId: "700800900", id: "123", name: "diwali_offer", language: "en", status: "REJECTED", reason: "INVALID_FORMAT" } }]);
  });
});

describe("24-hour window", () => {
  const now = new Date("2026-12-15T12:00:00Z");
  it("is open for a day after the customer's last message", () => {
    expect(windowState("2026-12-14T12:30:00Z", now).open).toBe(true);
    expect(windowState("2026-12-14T11:59:00Z", now).open).toBe(false);
    expect(windowState(null, now).open).toBe(false);
  });
});
