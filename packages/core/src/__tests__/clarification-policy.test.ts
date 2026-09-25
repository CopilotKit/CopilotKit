import { describe, expect, it } from "vitest";
import { hasFailedToolOutcome } from "../autopilot/clarification-policy";

describe("clarification after a tool outcome", () => {
  it("holds a new question after a failed or partial result in this user request", () => {
    expect(
      hasFailedToolOutcome([
        { role: "user", content: "Change two fields" },
        { role: "tool", content: JSON.stringify({ status: "partial" }) },
        { role: "tool", content: JSON.stringify({ controls: [] }) },
      ]),
    ).toBe(true);
    expect(
      hasFailedToolOutcome([
        { role: "user", content: "Find a target" },
        { role: "tool", content: "Error: control changed" },
      ]),
    ).toBe(true);
  });

  it("allows a new user request to clarify after an earlier failure", () => {
    expect(
      hasFailedToolOutcome([
        { role: "user", content: "First request" },
        { role: "tool", content: JSON.stringify({ status: "failed" }) },
        { role: "user", content: "Different request" },
        { role: "tool", content: JSON.stringify({ status: "arrived" }) },
      ]),
    ).toBe(false);
  });
});
