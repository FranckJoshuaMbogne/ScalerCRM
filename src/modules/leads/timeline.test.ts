import { describe, expect, it } from "vitest";
import { describeCustomerEvent, describeLeadActivity } from "./timeline";

const names = {
  status: (id: unknown) => ({ s1: "New", s2: "Contacted" })[id as string],
  source: (id: unknown) => ({ w: "Website" })[id as string],
  person: (id: unknown) => ({ u1: "Asha" })[id as string],
  reason: (id: unknown) => ({ r1: "Price too high" })[id as string],
};

describe("describeLeadActivity", () => {
  it("describes system events", () => {
    expect(describeLeadActivity({ type: "created", meta: { source_id: "w" } }, names)).toBe("created the lead from Website");
    expect(describeLeadActivity({ type: "status_changed", meta: { from: "s1", to: "s2" } }, names)).toBe(
      "moved it from New to Contacted",
    );
    expect(describeLeadActivity({ type: "assigned", meta: { changes: { owner_id: { from: null, to: "u1" } } } }, names)).toBe(
      "assigned it to Asha",
    );
    expect(
      describeLeadActivity({ type: "updated", meta: { changes: { title: {}, expected_value: {} } } }, names),
    ).toBe("changed interest, expected value");
    expect(describeLeadActivity({ type: "call", meta: {} }, names)).toBe("logged a call");
  });

  it("describes pipeline and task events", () => {
    expect(describeLeadActivity({ type: "created", meta: { source_id: "w", owner_id: "u1" } }, names)).toBe(
      "created the lead from Website for Asha",
    );
    expect(describeLeadActivity({ type: "status_changed", meta: { from: "s2", to: "s1", lost_reason_id: "r1" } }, names)).toBe(
      "moved it from Contacted to New (Price too high)",
    );
    expect(
      describeLeadActivity({ type: "task_created", meta: { task_type: "call", title: "Call back", assignee_id: "u1" } }, names),
    ).toBe("set a call: Call back for Asha");
    expect(describeLeadActivity({ type: "task_completed", meta: { title: "Call back" } }, names)).toBe("completed Call back");
  });
});

describe("describeCustomerEvent", () => {
  it("describes customer changes", () => {
    expect(describeCustomerEvent({ type: "updated", changes: { full_name: {}, gender: {} }, body: null })).toBe(
      "changed name, gender",
    );
    expect(describeCustomerEvent({ type: "contact_added", changes: { kind: "phone", value: "+91" }, body: null })).toBe(
      "added phone +91",
    );
  });
});
