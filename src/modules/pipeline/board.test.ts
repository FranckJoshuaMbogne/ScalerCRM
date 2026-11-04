import { describe, expect, it } from "vitest";
import { type BoardStatus, buildBoard, checkMove, sumMoney } from "./board";

const status = (id: string, position: number, extra: Partial<BoardStatus> = {}): BoardStatus => ({
  id,
  name: id.toUpperCase(),
  category: "open",
  stage: "new",
  position,
  isActive: true,
  requiresOwner: false,
  ...extra,
});

describe("sumMoney", () => {
  it("adds decimal strings exactly", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney(["45000.5", "1", null, ""])).toBe("45001.50");
    expect(sumMoney([])).toBe("0.00");
    expect(sumMoney(["999999999999.99", "0.01"])).toBe("1000000000000.00");
  });
});

describe("buildBoard", () => {
  const statuses = [status("b", 2), status("a", 1), status("hidden", 3, { isActive: false }), status("gone", 4, { isActive: false })];
  const leads = [
    { id: "1", statusId: "a", expectedValue: "100.00", ownerId: null },
    { id: "2", statusId: "a", expectedValue: "50.25", ownerId: "u" },
    { id: "3", statusId: "hidden", expectedValue: null, ownerId: null },
  ];

  it("orders columns, totals values, and keeps hidden stages that still hold leads", () => {
    const board = buildBoard(statuses, leads);
    expect(board.map((c) => c.status.id)).toEqual(["a", "b", "hidden"]);
    expect(board[0].total).toBe("150.25");
    expect(board[0].leads.map((l) => l.id)).toEqual(["1", "2"]);
    expect(board[1].leads).toEqual([]);
  });
});

describe("checkMove", () => {
  const name = (id: string) => id.toUpperCase();
  const lost = status("lost", 9, { category: "lost", stage: "lost" });
  const qualified = status("q", 5, { requiresOwner: true });

  it("asks for a lost reason when moving to a lost stage", () => {
    expect(checkMove({ statusId: "a", ownerId: null }, lost, {}, name)).toEqual({ ok: true, needsLostReason: true });
  });

  it("enforces allowed next stages", () => {
    const r = checkMove({ statusId: "a", ownerId: "u" }, qualified, { a: ["lost"] }, name);
    expect(r).toEqual({ ok: false, reason: "Leads in A can't move to Q." });
    expect(checkMove({ statusId: "b", ownerId: "u" }, qualified, { a: ["lost"] }, name).ok).toBe(true);
  });

  it("needs an owner where the stage says so", () => {
    expect(checkMove({ statusId: "a", ownerId: null }, qualified, {}, name).ok).toBe(false);
  });

  it("refuses no-op and hidden-stage moves", () => {
    expect(checkMove({ statusId: "q", ownerId: "u" }, qualified, {}, name).ok).toBe(false);
    expect(checkMove({ statusId: "a", ownerId: "u" }, status("x", 1, { isActive: false }), {}, name).ok).toBe(false);
  });
});

describe("ordering helpers", () => {
  it("moves ids up and down within bounds", async () => {
    const { moveId } = await import("./board");
    expect(moveId(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b", "c"], "x", "up")).toEqual(["a", "b", "c"]);
  });

  it("makes unique keys from names", async () => {
    const { uniqueKey } = await import("./board");
    expect(uniqueKey("Fitting booked", [])).toBe("fitting_booked");
    expect(uniqueKey("Fitting booked!", ["fitting_booked", "fitting_booked_2"])).toBe("fitting_booked_3");
    expect(uniqueKey("Café", [])).toBe("cafe");
    expect(uniqueKey("¡¡", [])).toBe("stage");
  });
});
