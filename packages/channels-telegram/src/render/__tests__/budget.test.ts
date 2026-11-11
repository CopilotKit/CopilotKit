import { describe, it, expect } from "vitest";
import {
  TELEGRAM_LIMITS,
  truncateText,
  clampArray,
  byteLen,
} from "../budget.js";

describe("budget", () => {
  it("truncates with ellipsis when over max", () => {
    expect(truncateText("hello", 3)).toBe("he…");
    expect(truncateText("hi", 5)).toBe("hi");
  });
  it("clamps arrays and reports overflow", () => {
    expect(clampArray([1, 2, 3], 2)).toEqual({ items: [1, 2], overflow: 1 });
  });
  it("measures UTF-8 byte length for callback_data budget", () => {
    expect(byteLen("é")).toBe(2);
    expect(TELEGRAM_LIMITS.callbackData).toBe(64);
  });
});
