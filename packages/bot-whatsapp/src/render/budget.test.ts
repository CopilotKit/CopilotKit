import { describe, it, expect } from "vitest";
import { WA_LIMITS, truncateText, clampArray } from "./budget.js";

describe("budget", () => {
  it("exposes WhatsApp Cloud API limits", () => {
    expect(WA_LIMITS.bodyText).toBe(4096);
    expect(WA_LIMITS.replyButtons).toBe(3);
    expect(WA_LIMITS.buttonTitle).toBe(20);
    expect(WA_LIMITS.listRows).toBe(10);
    expect(WA_LIMITS.rowTitle).toBe(24);
    expect(WA_LIMITS.rowDescription).toBe(72);
  });

  it("truncateText never exceeds max and marks truncation", () => {
    expect(truncateText("hello", 10)).toBe("hello");
    expect(truncateText("hello world", 5)).toBe("hell…");
    expect(truncateText("hello world", 5).length).toBe(5);
  });

  it("clampArray keeps max items and reports overflow", () => {
    expect(clampArray([1, 2, 3], 5)).toEqual({ items: [1, 2, 3], overflow: 0 });
    expect(clampArray([1, 2, 3, 4, 5], 3)).toEqual({
      items: [1, 2, 3],
      overflow: 2,
    });
  });
});
