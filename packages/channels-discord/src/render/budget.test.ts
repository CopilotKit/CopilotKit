import { describe, it, expect } from "vitest";
import {
  DISCORD_LIMITS,
  truncateText,
  truncateFenced,
  clampArray,
} from "./budget.js";

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

describe("truncateFenced", () => {
  it("leaves balanced-fence text within budget unchanged", () => {
    const text = "```\nhi\n```";
    expect(truncateFenced(text, 100)).toBe(text);
  });

  it("re-balances an open fence left by truncation", () => {
    // A fenced table that gets cut mid-content leaves an odd fence count.
    const text = "```\n| A | B |\n| 1 | 2 |\n| 3 | 4 |\n```";
    const out = truncateFenced(text, 20);
    expect(out.length).toBeLessThanOrEqual(20);
    // Even number of fence delimiters → the block is closed.
    expect((out.match(/```/g) ?? []).length % 2).toBe(0);
    expect(out.endsWith("```")).toBe(true);
  });

  it("does not add a fence when none is open", () => {
    const out = truncateFenced("plain text with no fences here", 10);
    expect(out).not.toContain("```");
    expect(out.length).toBeLessThanOrEqual(10);
  });

  it("never exceeds max even when max is smaller than the closing fence", () => {
    // An open fence with max=3 (< "\n```".length = 4) must not append a 4-char
    // closer that overruns max; it falls back to a plain clamp.
    const longFenced = "```\n" + "a".repeat(50);
    const out = truncateFenced(longFenced, 3);
    expect(out.length).toBeLessThanOrEqual(3);
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
    expect(DISCORD_LIMITS.totalTextChars).toBe(4000);
    expect(DISCORD_LIMITS.selectPlaceholder).toBe(150);
  });
});
