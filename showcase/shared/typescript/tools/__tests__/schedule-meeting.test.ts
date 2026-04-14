import { describe, it, expect } from "vitest";
import { scheduleMeetingImpl } from "../schedule-meeting";

describe("scheduleMeetingImpl", () => {
  it("returns pending_approval status", () => {
    expect(scheduleMeetingImpl("discuss roadmap").status).toBe(
      "pending_approval",
    );
  });
  it("includes the reason", () => {
    expect(scheduleMeetingImpl("quarterly review").reason).toBe(
      "quarterly review",
    );
  });
  it("uses default 30-minute duration", () => {
    expect(scheduleMeetingImpl("sync").duration_minutes).toBe(30);
  });
  it("accepts custom duration", () => {
    expect(scheduleMeetingImpl("deep dive", 60).duration_minutes).toBe(60);
  });
  it("includes a message", () => {
    const result = scheduleMeetingImpl("onboarding", 45);
    expect(result.message).toContain("onboarding");
    expect(result.message).toContain("45");
  });
});
