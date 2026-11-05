import { describe, expect, it } from "vitest";
import { limitMessage, usageRows } from "./limits";

describe("plan limits", () => {
  it("turns database limit errors into sentences", () => {
    expect(limitMessage("plan limit reached: max_branches (limit 1)")).toBe(
      "Your plan allows 1 branch. Move to a bigger plan to add another.",
    );
    expect(limitMessage("plan limit reached: monthly_messages (limit 10000)")).toContain("10,000 template messages");
    expect(limitMessage("something else")).toBeNull();
  });

  it("works out usage levels, with null meaning unlimited", () => {
    const rows = usageRows({ max_users: 5, max_branches: null, monthly_messages: 1000 }, { max_users: 5, max_branches: 7, monthly_messages: 850 });
    expect(rows.find((r) => r.key === "max_users")).toMatchObject({ percent: 100, level: "full" });
    expect(rows.find((r) => r.key === "max_branches")).toMatchObject({ limit: null, percent: null, level: "ok" });
    expect(rows.find((r) => r.key === "monthly_messages")).toMatchObject({ percent: 85, level: "near" });
  });
});
