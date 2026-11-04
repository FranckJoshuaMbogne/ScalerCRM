import { describe, expect, it } from "vitest";
import { buildEnvelope, parseDsn } from "./monitoring";

describe("monitoring", () => {
  it("turns a DSN into the envelope endpoint and key", () => {
    expect(parseDsn("https://abc123@o42.ingest.sentry.io/7")).toEqual({
      url: "https://o42.ingest.sentry.io/api/7/envelope/",
      publicKey: "abc123",
    });
    expect(parseDsn("not a dsn")).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
  });

  it("builds a three-line envelope with the error and tags only", () => {
    const err = Object.assign(new Error("boom"), { digest: "123" });
    const lines = buildEnvelope(err, { route: "/leads/[id]" }, new Date("2027-03-01T00:00:00Z"), "a".repeat(32)).split("\n");
    expect(lines).toHaveLength(3);
    const event = JSON.parse(lines[2]);
    expect(event.exception.values[0]).toEqual({ type: "Error", value: "boom" });
    expect(event.tags).toEqual({ route: "/leads/[id]", digest: "123" });
    expect(event).not.toHaveProperty("request");
  });
});
