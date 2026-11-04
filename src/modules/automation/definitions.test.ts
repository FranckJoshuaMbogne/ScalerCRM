import { describe, expect, it } from "vitest";
import { describeAction, validateAutomation } from "./definitions";

describe("automation definitions", () => {
  it("accepts a valid automation", () => {
    expect(
      validateAutomation({
        name: "Chase quiet leads",
        trigger: "lead_idle",
        triggerConfig: { days: 3 },
        conditions: [{ field: "expected_value", op: "gte", value: "10000" }],
        actions: [{ type: "wait", minutes: 60 }, { type: "notify", to: "owner", title: "Quiet lead" }],
      }),
    ).toEqual([]);
  });

  it("explains what is wrong", () => {
    expect(
      validateAutomation({
        name: "",
        trigger: "lead_idle",
        triggerConfig: { days: 0 },
        conditions: [{ field: "score", op: "gte", value: "lots" }],
        actions: [{ type: "wait", minutes: 30 }],
      }),
    ).toEqual(["Name the automation.", "Idle days must be between 1 and 90.", "Lead score needs a number.", "Add an action after the wait."]);
  });

  it("describes actions in plain words", () => {
    expect(describeAction({ type: "create_task", task_type: "call", title: "Call", due_in_minutes: 1440, assignee: "owner" })).toBe(
      "create the task “Call” due in 1 day for the owner",
    );
    expect(describeAction({ type: "wait", minutes: 4320 })).toBe("wait 3 days");
    expect(describeAction({ type: "notify", to: "managers", title: "Heads up" })).toBe("notify managers: “Heads up”");
  });
});
