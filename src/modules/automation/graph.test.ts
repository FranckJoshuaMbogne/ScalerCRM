import { describe, expect, it } from "vitest";
import { connect, type Graph, graphErrors, linearToGraph, newNode, removeNode } from "./graph";

const base: Graph = {
  nodes: [
    { id: "t", kind: "trigger", trigger: "lead_created", config: {}, next: "c", x: 0, y: 0 },
    { id: "c", kind: "condition", match: "all", conditions: [{ field: "has_owner", op: "is_true" }], yes: "a", no: "b", x: 0, y: 120 },
    { id: "a", kind: "action", action: { type: "add_tag", tag: "Owned" }, next: "w", x: -150, y: 240 },
    { id: "b", kind: "action", action: { type: "assign_round_robin" }, next: "w", x: 150, y: 240 },
    { id: "w", kind: "wait_for_reply", timeout_minutes: 60, replied: null, timeout: null, x: 0, y: 360 },
  ],
};

describe("workflow graphs", () => {
  it("accept branches that join again", () => {
    expect(graphErrors(base)).toEqual([]);
  });

  it("find loops, loose steps and missing settings", () => {
    expect(graphErrors(connect(base, "w", "timeout", "c"))).toContain("The workflow loops back on itself. Steps can only lead forward.");
    expect(graphErrors({ nodes: [...base.nodes, newNode("wait", "z", 0, 0)] })).toContain("Some steps are not connected to the trigger.");
    expect(graphErrors({ nodes: base.nodes.filter((n) => n.kind !== "trigger") })).toContain("A workflow starts with exactly one trigger.");
    expect(graphErrors(connect(base, "a", "next", "a"))).toContain("A step cannot lead to itself.");
    const email = newNode("action", "e", 0, 0, { type: "send_email", to: "customer", subject: "", body: "Hi" });
    expect(graphErrors({ nodes: [...base.nodes.map((n) => (n.id === "w" ? { ...n, replied: "e" } : n)), email] })).toContain(
      "Emails need a recipient, a subject and a message.",
    );
  });

  it("remove a step and its connections, but never the trigger", () => {
    const g = removeNode(base, "w");
    expect(g.nodes.map((n) => n.id)).toEqual(["t", "c", "a", "b"]);
    expect(g.nodes.find((n) => n.id === "a")!.next).toBeNull();
    expect(removeNode(base, "t")).toBe(base);
  });

  it("convert Sprint 8 automations exactly as the database does", () => {
    // private.linear_to_graph output for the "unassigned_alert" preset.
    expect(
      linearToGraph("lead_created", {}, [{ field: "has_owner", op: "is_false" }], [
        { type: "wait", minutes: 10 },
        { type: "assign_round_robin" },
        { type: "notify", to: "managers", title: "A new lead is waiting for an owner" },
      ]),
    ).toEqual({
      nodes: [
        { id: "t", kind: "trigger", trigger: "lead_created", config: {}, next: "c", x: 0, y: 0 },
        { id: "c", kind: "condition", match: "all", conditions: [{ field: "has_owner", op: "is_false" }], yes: "a1", no: null, x: 0, y: 120 },
        { id: "a1", kind: "wait", minutes: 10, next: "a2", x: 0, y: 240 },
        { id: "a2", kind: "action", action: { type: "assign_round_robin" }, next: "a3", x: 0, y: 360 },
        { id: "a3", kind: "action", action: { type: "notify", to: "managers", title: "A new lead is waiting for an owner" }, next: null, x: 0, y: 480 },
      ],
    });
  });
});
