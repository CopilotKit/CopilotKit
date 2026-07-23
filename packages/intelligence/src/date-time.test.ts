import { describe, expect, test } from "vitest";
import { compareCanonicalDateTimes } from "./date-time.js";

describe("compareCanonicalDateTimes", () => {
  test.each([
    "2026-01-01T00:00:00+24:00",
    "2026-01-01T00:00:00-24:00",
    "2026-01-01T00:00:00+23:60",
    "2026-01-01T00:00:00-23:60",
    "2026-01-01T00:00:00+99:99",
  ])("rejects the out-of-range UTC offset in %s", (value) => {
    expect(compareCanonicalDateTimes(value, value)).toBeUndefined();
  });

  test.each([
    ["2026-01-01T23:59:00+23:59", "2026-01-01T00:00:00Z"],
    ["2025-12-31T00:01:00-23:59", "2026-01-01T00:00:00Z"],
  ])("accepts the valid edge offset in %s", (value, equivalentUtcValue) => {
    expect(compareCanonicalDateTimes(value, equivalentUtcValue)).toBe(0);
  });

  test.each([
    "2023-02-29T00:00:00Z",
    "2024-02-30T00:00:00Z",
    "2026-04-31T00:00:00Z",
  ])("rejects the impossible calendar date in %s", (value) => {
    expect(compareCanonicalDateTimes(value, value)).toBeUndefined();
  });

  test("accepts leap day at the calendar boundary", () => {
    expect(
      compareCanonicalDateTimes("2024-02-29T23:59:59Z", "2024-03-01T00:00:00Z"),
    ).toBe(-1);
  });

  test("preserves exact ordering beyond millisecond precision", () => {
    expect(
      compareCanonicalDateTimes(
        "2026-01-01T00:00:00.00000000000000000001Z",
        "2026-01-01T00:00:00.00000000000000000002Z",
      ),
    ).toBe(-1);
    expect(
      compareCanonicalDateTimes(
        "2026-01-01T00:00:00.100Z",
        "2026-01-01T00:00:00.1Z",
      ),
    ).toBe(0);
  });
});
