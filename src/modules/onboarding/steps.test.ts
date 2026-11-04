import { describe, expect, it } from "vitest";
import { nextStep, type OnboardingStatus, progress, showChecklist, STEPS } from "./steps";

const blank = (): OnboardingStatus => ({
  steps: { profile: false, template: false, branches: false, team: false, whatsapp: false, import: false, app: false },
  skipped: {},
  templateKey: null,
  completedAt: null,
  dismissedAt: null,
  isDemo: false,
});

describe("setup steps", () => {
  it("has fewer than 10 steps", () => {
    expect(STEPS.length).toBeLessThan(10);
  });

  it("resumes at the first step neither done nor skipped", () => {
    const s = blank();
    expect(nextStep(s)).toBe("profile");
    s.steps.profile = true;
    s.steps.template = true;
    s.skipped.branches = true;
    s.steps.branches = true;
    expect(nextStep(s)).toBe("team");
  });

  it("counts skipped steps as not done", () => {
    const s = blank();
    s.steps.app = true;
    s.skipped.app = true;
    s.steps.profile = true;
    expect(progress(s)).toEqual({ done: 1, total: 7 });
  });

  it("is finished when every step is done or skipped", () => {
    const s = blank();
    for (const k of STEPS) s.steps[k.key] = true;
    expect(nextStep(s)).toBeNull();
  });

  it("shows the checklist until finished or hidden, never in a demo", () => {
    const s = blank();
    expect(showChecklist(s)).toBe(true);
    expect(showChecklist({ ...s, dismissedAt: "2027-05-03T00:00:00Z" })).toBe(false);
    expect(showChecklist({ ...s, isDemo: true })).toBe(false);
  });
});
