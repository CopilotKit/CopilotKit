import { describe, expect, it } from "vitest";
import { formatDate } from "./format-date";

describe("formatDate", () => {
  it("formats an ISO instant deterministically in en-US / UTC", () => {
    // 13:45 UTC — pinned locale + zone means this is stable regardless of the
    // machine's locale or timezone (guards against the hydration mismatch).
    expect(formatDate("2026-02-14T13:45:12Z")).toBe("Feb 14, 2026, UTC");
  });

  it("renders a zone-offset input in UTC (not the input's local zone)", () => {
    // 02:30 at +05:30 is 21:00 UTC on the PREVIOUS day; an early-morning +05:30
    // input that lands before midnight UTC must print the earlier UTC calendar day.
    expect(formatDate("2026-02-14T02:30:00+05:30")).toBe("Feb 13, 2026, UTC");
  });

  it("normalizes an offset timestamp to UTC (calendar day may shift forward)", () => {
    // 23:30 at -05:00 is 04:30 the NEXT day in UTC. Pinning the zone is what
    // makes this deterministic — server and client must agree on the day.
    expect(formatDate("2026-08-04T23:30:00-05:00")).toBe("Aug 5, 2026, UTC");
  });

  it("returns the raw string for an unparseable value", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });

  it("returns an empty string verbatim", () => {
    expect(formatDate("")).toBe("");
  });
});
