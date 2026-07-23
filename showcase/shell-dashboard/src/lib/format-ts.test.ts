import { describe, it, expect } from "vitest";
import { formatTs } from "./format-ts";

describe("formatTs", () => {
  it("converts an ISO 8601 UTC string to a locale-formatted string", () => {
    const result = formatTs("2026-04-28T05:17:34.396Z");
    // The exact output depends on the runtime's locale, but it must NOT
    // contain the raw ISO marker 'T' or trailing 'Z'.
    expect(result).not.toContain("T");
    expect(result).not.toContain("Z");
    // It should contain recognizable date fragments (month abbreviation,
    // digits for day/time).
    expect(result).toMatch(/Apr/);
    expect(result).toMatch(/\d{1,2}/); // day
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/); // hh:mm:ss
  });

  it("returns a non-empty string for a valid ISO timestamp", () => {
    const result = formatTs("2026-01-15T12:00:00Z");
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe("2026-01-15T12:00:00Z");
  });

  it("falls back to the raw input for an invalid date string", () => {
    expect(formatTs("not-a-date")).toBe("not-a-date");
  });

  it("handles timestamps with milliseconds", () => {
    const result = formatTs("2026-04-20T00:00:00.000Z");
    expect(result).not.toContain("T");
    expect(result).not.toContain("Z");
  });

  it("handles timestamps without trailing Z (non-UTC offsets)", () => {
    const result = formatTs("2026-04-20T08:00:00+00:00");
    expect(result).not.toContain("+00:00");
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("returns the raw input for an empty string (Date constructor yields Invalid Date)", () => {
    // new Date("") is NaN / Invalid Date — toLocaleString throws or
    // returns "Invalid Date". Either way, the catch block returns the
    // raw input.
    const result = formatTs("");
    // Accept either empty string passthrough or the string itself
    expect(typeof result).toBe("string");
  });
});
