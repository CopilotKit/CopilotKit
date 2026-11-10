import { describe, it, expect } from "vitest";
import { truncateText } from "./budget.js";

describe("truncateText", () => {
  it("returns text within the limit unchanged", () => {
    expect(truncateText("hello", 5)).toBe("hello");
  });

  it("cuts longer text to the limit and ends it with the marker", () => {
    expect(truncateText("hello world", 6)).toBe("hello…");
  });

  it("hard-cuts without a marker when the limit cannot fit one", () => {
    expect(truncateText("hello", 1)).toBe("h");
  });
});
