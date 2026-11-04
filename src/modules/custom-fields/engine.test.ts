import { describe, expect, it } from "vitest";
import { coerce, fieldKey, type FieldDefinition, formatCustomValue, parseOptions, readCustomFields } from "./engine";

const def = (over: Partial<FieldDefinition>): FieldDefinition => ({
  id: "x",
  entity: "lead",
  key: "k",
  label: "Field",
  type: "text",
  options: [],
  required: false,
  helpText: null,
  position: 0,
  isActive: true,
  ...over,
});

describe("fieldKey", () => {
  it("makes database-safe keys", () => {
    expect(fieldKey("Chest (inches)")).toBe("chest_inches");
    expect(fieldKey("2nd fitting date")).toBe("nd_fitting_date");
    expect(fieldKey("Garmént type")).toBe("garment_type");
    expect(fieldKey("!!!")).toBe("field");
    expect(fieldKey("x".repeat(60))).toHaveLength(40);
  });
});

describe("parseOptions", () => {
  it("splits lines or commas and removes blanks and duplicates", () => {
    expect(parseOptions("Suit\nSherwani\n\nSuit")).toEqual(["Suit", "Sherwani"]);
    expect(parseOptions("Suit, Sherwani , Kurta")).toEqual(["Suit", "Sherwani", "Kurta"]);
  });
});

describe("coerce", () => {
  it("validates by type", () => {
    expect(coerce(def({ type: "number" }), "1,250.5")).toEqual({ value: 1250.5 });
    expect(coerce(def({ type: "number" }), "abc")).toHaveProperty("error");
    expect(coerce(def({ type: "date" }), "2026-02-30")).toHaveProperty("error");
    expect(coerce(def({ type: "date" }), "2026-12-01")).toEqual({ value: "2026-12-01" });
    expect(coerce(def({ type: "select", options: ["A", "B"] }), "C")).toHaveProperty("error");
    expect(coerce(def({ type: "multiselect", options: ["A", "B"] }), ["A", "B", "A"])).toEqual({ value: ["A", "B"] });
    expect(coerce(def({ type: "boolean" }), "on")).toEqual({ value: true });
    expect(coerce(def({ type: "boolean" }), undefined)).toEqual({ value: false });
  });

  it("enforces required fields and skips empty optional ones", () => {
    expect(coerce(def({ required: true }), "")).toEqual({ error: "Field is required." });
    expect(coerce(def({}), "")).toEqual({ value: undefined });
  });
});

describe("readCustomFields", () => {
  it("reads prefixed inputs, ignores inactive fields and reports errors by input name", () => {
    const form = new FormData();
    form.set("cf_garment", "Suit");
    form.append("cf_extras", "Tie");
    form.append("cf_extras", "Pocket square");
    form.set("cf_chest", "forty");
    form.set("cf_old", "ignored");
    const { values, errors } = readCustomFields(
      [
        def({ key: "garment", type: "select", options: ["Suit", "Sherwani"] }),
        def({ key: "extras", type: "multiselect", options: ["Tie", "Pocket square"] }),
        def({ key: "chest", label: "Chest", type: "number" }),
        def({ key: "old", isActive: false }),
      ],
      form,
    );
    expect(values).toEqual({ garment: "Suit", extras: ["Tie", "Pocket square"] });
    expect(errors).toEqual({ cf_chest: "Chest must be a number." });
  });
});

describe("formatCustomValue", () => {
  it("formats for display", () => {
    expect(formatCustomValue({ type: "boolean" }, true)).toBe("Yes");
    expect(formatCustomValue({ type: "multiselect" }, ["A", "B"])).toBe("A, B");
    expect(formatCustomValue({ type: "text" }, undefined)).toBe("—");
    expect(formatCustomValue({ type: "date" }, "2026-12-01")).toBe("1 Dec 2026");
  });
});
