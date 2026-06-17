import { describe, it, expect } from "vitest";
import { GCHAT_LIMITS, truncateText, clampArray } from "./budget.js";

describe("truncateText", () => {
  it("returns the input unchanged when length is at or under max", () => {
    expect(truncateText("hello", 5)).toBe("hello");
    expect(truncateText("hi", 10)).toBe("hi");
    expect(truncateText("", 3)).toBe("");
  });

  it("truncates and appends an ellipsis marker when longer than max", () => {
    const out = truncateText("abcdefgh", 5);
    expect(out).toBe("abcd…");
    // Never exceeds max chars (4 sliced chars + 1 ellipsis = 5).
    expect(out.length).toBe(5);
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it("never returns more than max characters for long input", () => {
    const long = "x".repeat(100);
    const out = truncateText(long, 10);
    expect(out.length).toBe(10);
    expect(out.endsWith("…")).toBe(true);
  });

  it("handles the max <= 1 edge branch: max=1 yields the first char, no ellipsis", () => {
    // For max=1 the input "ab" is longer than max, so the `max <= 1` branch
    // runs: slice(0, 1) → first char, no ellipsis (which would overflow).
    expect(truncateText("ab", 1)).toBe("a");
    expect(truncateText("a", 1)).toBe("a"); // length <= max → unchanged
  });

  it("handles the max=0 edge branch: yields an empty string", () => {
    // "ab".length (2) > 0, max <= 1 branch → slice(0, 0) → "".
    expect(truncateText("ab", 0)).toBe("");
    expect(truncateText("", 0)).toBe(""); // length <= max → unchanged
  });
});

describe("clampArray", () => {
  it("returns all items and zero overflow when at or under max", () => {
    expect(clampArray([1, 2, 3], 5)).toEqual({ items: [1, 2, 3], overflow: 0 });
    expect(clampArray([1, 2, 3], 3)).toEqual({ items: [1, 2, 3], overflow: 0 });
    expect(clampArray([], 2)).toEqual({ items: [], overflow: 0 });
  });

  it("returns a copy of the items (not the same reference) when under max", () => {
    const src = [1, 2];
    const out = clampArray(src, 5);
    expect(out.items).toEqual([1, 2]);
    expect(out.items).not.toBe(src);
  });

  it("keeps the first max items and reports the overflow count when over max", () => {
    expect(clampArray([1, 2, 3, 4, 5], 2)).toEqual({
      items: [1, 2],
      overflow: 3,
    });
    expect(clampArray(["a", "b", "c"], 1)).toEqual({
      items: ["a"],
      overflow: 2,
    });
  });
});

describe("GCHAT_LIMITS", () => {
  it("documents the expected Google Chat limits", () => {
    expect(GCHAT_LIMITS.cardsPerMessage).toBe(100);
    expect(GCHAT_LIMITS.widgetsPerCard).toBe(100);
    expect(GCHAT_LIMITS.headerText).toBe(200);
    expect(GCHAT_LIMITS.textParagraph).toBe(4000);
    expect(GCHAT_LIMITS.buttonText).toBe(40);
    expect(GCHAT_LIMITS.buttonsPerSet).toBe(6);
    expect(GCHAT_LIMITS.decoratedTextTop).toBe(4000);
  });
});
