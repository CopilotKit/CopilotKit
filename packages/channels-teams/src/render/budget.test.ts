import { describe, it, expect } from "vitest";
import { truncateText, clampArray, TEAMS_LIMITS } from "./budget.js";

describe("truncateText", () => {
  it("leaves short text unchanged", () => {
    expect(truncateText("hi", 10)).toBe("hi");
  });
  it("truncates with an ellipsis and never exceeds max", () => {
    const out = truncateText("abcdef", 4);
    expect(out).toBe("abc…");
    expect(out.length).toBe(4);
  });
});

describe("clampArray", () => {
  it("keeps everything under the cap", () => {
    expect(clampArray([1, 2], 5)).toEqual({ items: [1, 2], overflow: 0 });
  });
  it("clamps and reports overflow", () => {
    expect(clampArray([1, 2, 3, 4], 2)).toEqual({ items: [1, 2], overflow: 2 });
  });
});

describe("TEAMS_LIMITS", () => {
  it("caps top-level actions to a Teams-friendly count", () => {
    expect(TEAMS_LIMITS.actions).toBe(6);
  });
});
