import { describe, expect, it } from "vitest";
import { countVariables, renderBody, toProviderTemplate, toSendComponents, validateTemplate } from "./template";

describe("template variables", () => {
  it("counts {{1}}…{{n}} and rejects gaps or edge variables", () => {
    expect(countVariables("Hi {{1}}, your order {{2}} is ready.")).toEqual({ ok: true, count: 2 });
    expect(countVariables("No variables")).toEqual({ ok: true, count: 0 });
    expect(countVariables("Hi {{1}} and {{3}} done").ok).toBe(false);
    expect(countVariables("{{1}} is ready").ok).toBe(false);
  });

  it("renders the customer's text", () => {
    expect(renderBody("Hi {{1}}, {{2}} off", ["Ravi", "20%"])).toBe("Hi Ravi, 20% off");
    expect(renderBody("Hi {{1}}", [])).toBe("Hi {{1}}");
  });
});

describe("validateTemplate", () => {
  it("accepts a well-formed marketing template", () => {
    expect(
      validateTemplate("diwali_offer", {
        body: { text: "Hi {{1}}, 20% off this Diwali.", examples: ["Ravi"] },
        buttons: [{ type: "QUICK_REPLY", text: "Stop promotions" }],
      }),
    ).toEqual([]);
  });

  it("explains what Meta would reject", () => {
    const errors = validateTemplate("Diwali Offer", {
      header: { format: "TEXT", text: "" },
      body: { text: "Hi {{1}}, offer inside", examples: [] },
      buttons: [{ type: "URL", text: "Shop", url: "http://x" }],
    });
    expect(errors).toEqual([
      "Name: lowercase letters, numbers and underscores only.",
      "Give an example value for every variable; Meta reviews them.",
      "A text header needs text.",
      "Website buttons need a full https:// address.",
    ]);
  });
});

describe("provider payloads", () => {
  const c = {
    header: { format: "IMAGE" as const, handle: "4::aW1hZ2U=" },
    body: { text: "Hi {{1}}, new arrivals are in.", examples: ["Ravi"] },
    footer: { text: "Reply STOP to opt out" },
    buttons: [{ type: "QUICK_REPLY" as const, text: "Stop promotions" }],
  };

  it("builds the create payload", () => {
    expect(toProviderTemplate("new_arrivals", "en", "MARKETING", c)).toEqual({
      name: "new_arrivals",
      language: "en",
      category: "MARKETING",
      components: [
        { type: "HEADER", format: "IMAGE", example: { header_handle: ["4::aW1hZ2U="] } },
        { type: "BODY", text: "Hi {{1}}, new arrivals are in.", example: { body_text: [["Ravi"]] } },
        { type: "FOOTER", text: "Reply STOP to opt out" },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Stop promotions" }] },
      ],
    });
  });

  it("builds the send components", () => {
    expect(toSendComponents(c, ["Priya"], "https://cdn.example.com/a.jpg")).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://cdn.example.com/a.jpg" } }] },
      { type: "body", parameters: [{ type: "text", text: "Priya" }] },
    ]);
    expect(toSendComponents({ body: { text: "Hello" } }, [])).toEqual([]);
  });
});
