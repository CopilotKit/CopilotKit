import { describe, expect, it } from "vitest";
import { formatStepTime } from "./format-step-time";

describe("formatStepTime", () => {
  it("formats an ISO timestamp deterministically in fixed en-US/UTC", () => {
    // The point of the helper: the same input yields the same string no matter
    // the host's locale or timezone, which is what prevents the server/client
    // hydration mismatch. The instant below is 15:45:12 UTC.
    expect(formatStepTime("2026-08-04T15:45:12.000Z")).toBe("3:45:12 PM UTC");
  });

  it("does not shift with the host timezone (both offsets agree)", () => {
    // A non-UTC-labelled ISO instant still renders in UTC, so a server in one
    // zone and a browser in another produce identical markup.
    expect(formatStepTime("2026-08-04T15:45:12+02:00")).toBe("1:45:12 PM UTC");
  });

  it("returns null for a missing timestamp", () => {
    expect(formatStepTime(undefined)).toBeNull();
  });

  it("returns null for an unparseable timestamp", () => {
    expect(formatStepTime("not-a-date")).toBeNull();
  });
});
