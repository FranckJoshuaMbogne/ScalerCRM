import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, presentList, presentWrite } from "./present";

describe("cursors", () => {
  it("round-trip microsecond timestamps exactly", () => {
    const next = { t: "2027-05-17T10:15:30.123456+05:30", id: "6f1c2a7e-8a0b-4c1d-9e2f-3a4b5c6d7e8f" };
    expect(decodeCursor(encodeCursor(next))).toEqual(next);
  });

  it("refuse anything else", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from('["x","y"]').toString("base64url"))).toBeNull();
  });
});

describe("presenters", () => {
  it("only give a cursor when there is more", () => {
    const next = { t: "2027-05-17T10:15:30+00:00", id: "6f1c2a7e-8a0b-4c1d-9e2f-3a4b5c6d7e8f" };
    expect(presentList({ object: "list", data: [1], has_more: true, next }).next_cursor).toBe(encodeCursor(next));
    expect(presentList({ object: "list", data: [], has_more: false, next: null }).next_cursor).toBeNull();
  });

  it("unwrap writes", () => {
    expect(presentWrite({ status: 201, order: { id: "o" }, replayed: true }, "order")).toEqual({ status: 201, body: { id: "o" }, replayed: true });
  });
});
