import { describe, it, expect } from "vitest";
import { DISCORD_LIMITS, truncateText, clampArray } from "./budget.js";

describe("truncateText", () => {
  it("returns short text unchanged", () => {
    expect(truncateText("hi", 10)).toBe("hi");
  });
  it("truncates with an ellipsis at the limit", () => {
    const out = truncateText("abcdefghij", 5);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("clampArray", () => {
  it("keeps all items under the cap and reports zero overflow", () => {
    expect(clampArray([1, 2, 3], 5)).toEqual({ items: [1, 2, 3], overflow: 0 });
  });
  it("clamps over the cap and reports overflow count", () => {
    expect(clampArray([1, 2, 3, 4], 2)).toEqual({ items: [1, 2], overflow: 2 });
  });
});

describe("DISCORD_LIMITS", () => {
  it("pins the documented ceilings", () => {
    expect(DISCORD_LIMITS.componentsPerMessage).toBe(40);
    expect(DISCORD_LIMITS.customId).toBe(100);
    expect(DISCORD_LIMITS.buttonsPerRow).toBe(5);
    expect(DISCORD_LIMITS.actionRows).toBe(5);
    expect(DISCORD_LIMITS.selectOptions).toBe(25);
    expect(DISCORD_LIMITS.textDisplayChars).toBe(2000);
  });
});
