import { describe, it, expect } from "vitest";
import { truncateText } from "./budget.js";

describe("truncateText", () => {
  it("returns text at or under the limit unchanged", () => {
    expect(truncateText("hello", 5)).toBe("hello");
  });

  it("cuts long text to the limit and ends it with an ellipsis", () => {
    expect(truncateText("hello world", 6)).toBe("hello…");
  });

  it("drops the ellipsis when the limit has no room for it", () => {
    expect(truncateText("hello", 1)).toBe("h");
    expect(truncateText("hello", 0)).toBe("");
  });
});
