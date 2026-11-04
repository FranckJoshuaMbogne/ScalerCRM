import { describe, expect, it } from "vitest";
import {
  bucketFor,
  describeDue,
  followUpPresets,
  offsetMinutes,
  parseLocalInput,
  resolvePreset,
  startOfDay,
  toLocalInput,
} from "./schedule";

const IST = "Asia/Kolkata";
const NY = "America/New_York";

describe("time zones", () => {
  it("knows IST is +5:30", () => {
    expect(offsetMinutes(new Date("2026-12-15T00:00:00Z"), IST)).toBe(330);
  });

  it("reads datetime-local values as business-local time", () => {
    expect(parseLocalInput("2026-12-15T10:30", IST)?.toISOString()).toBe("2026-12-15T05:00:00.000Z");
    expect(parseLocalInput("2026-07-01T09:00", NY)?.toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(parseLocalInput("2026-01-15T09:00", NY)?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("rejects malformed and impossible dates", () => {
    expect(parseLocalInput("2026-02-31T10:00", IST)).toBeNull();
    expect(parseLocalInput("tomorrow", IST)).toBeNull();
    expect(parseLocalInput("2026-12-15T25:00", IST)).toBeNull();
  });

  it("round-trips through the input format", () => {
    const d = new Date("2026-12-15T05:00:00Z");
    expect(toLocalInput(d, IST)).toBe("2026-12-15T10:30");
    expect(parseLocalInput(toLocalInput(d, IST), IST)?.getTime()).toBe(d.getTime());
  });

  it("finds the start of the local day", () => {
    // 20:00 UTC on the 14th is already 01:30 on the 15th in India.
    expect(startOfDay(new Date("2026-12-14T20:00:00Z"), IST).toISOString()).toBe("2026-12-14T18:30:00.000Z");
    expect(startOfDay(new Date("2026-12-14T20:00:00Z"), IST, 1).toISOString()).toBe("2026-12-15T18:30:00.000Z");
  });
});

describe("follow-up presets", () => {
  const morning = new Date("2026-12-15T04:30:00Z"); // 10:00 IST
  const night = new Date("2026-12-15T15:30:00Z"); // 21:00 IST

  it("offers this evening only before 5 pm", () => {
    expect(followUpPresets(morning, IST).map((p) => p.key)).toContain("evening");
    expect(followUpPresets(night, IST).map((p) => p.key)).not.toContain("evening");
  });

  it("puts tomorrow at 10 am local", () => {
    expect(resolvePreset("tomorrow", night, IST)?.toISOString()).toBe("2026-12-16T04:30:00.000Z");
  });

  it("rounds 'in 1 hour' up to five minutes", () => {
    const at = resolvePreset("1h", new Date("2026-12-15T04:31:10Z"), IST);
    expect(at?.toISOString()).toBe("2026-12-15T05:35:00.000Z");
  });

  it("returns null for unknown presets", () => {
    expect(resolvePreset("someday", morning, IST)).toBeNull();
  });
});

describe("my day buckets", () => {
  const now = new Date("2026-12-15T06:30:00Z"); // 12:00 IST

  it("sorts tasks into overdue, today and upcoming", () => {
    expect(bucketFor(new Date("2026-12-15T06:00:00Z"), now, IST)).toBe("overdue");
    expect(bucketFor(new Date("2026-12-15T12:00:00Z"), now, IST)).toBe("today");
    expect(bucketFor(new Date("2026-12-15T18:30:00Z"), now, IST)).toBe("upcoming");
  });

  it("describes due times for people", () => {
    expect(describeDue(new Date("2026-12-15T03:30:00Z"), now, IST)).toBe("3 h overdue");
    expect(describeDue(new Date("2026-12-13T06:30:00Z"), now, IST)).toBe("2 days overdue");
    expect(describeDue(new Date("2026-12-15T11:00:00Z"), now, IST)).toMatch(/^Today 4:30\spm$/i);
    expect(describeDue(new Date("2026-12-16T04:30:00Z"), now, IST)).toMatch(/^Tomorrow 10:00\sam$/i);
  });
});

describe("calendar helpers", async () => {
  const { localDateKey, parseLocalDate, startOfWeek } = await import("./schedule");
  it("keys and parses local dates", () => {
    expect(localDateKey(new Date("2026-12-14T20:00:00Z"), IST)).toBe("2026-12-15");
    expect(parseLocalDate("2026-12-15", IST)?.toISOString()).toBe("2026-12-14T18:30:00.000Z");
    expect(parseLocalDate("15/12/2026", IST)).toBeNull();
  });
  it("starts weeks on Monday", () => {
    // Thursday 17 Dec 2026, 10:00 IST → Monday 14 Dec 00:00 IST
    expect(startOfWeek(new Date("2026-12-17T04:30:00Z"), IST).toISOString()).toBe("2026-12-13T18:30:00.000Z");
  });
});
