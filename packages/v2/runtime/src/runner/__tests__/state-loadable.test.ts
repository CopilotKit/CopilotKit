import { describe, it, expect } from "vitest";
import { isStateLoadable } from "../../types/state-loadable";

describe("isStateLoadable", () => {
  it("returns true for objects with a loadState function", () => {
    const agent = {
      loadState: async () => null,
    };
    expect(isStateLoadable(agent)).toBe(true);
  });

  it("returns false for objects without loadState", () => {
    expect(isStateLoadable({})).toBe(false);
    expect(isStateLoadable({ loadState: "not-a-function" })).toBe(false);
  });

  it("returns false for null and undefined", () => {
    expect(isStateLoadable(null)).toBe(false);
    expect(isStateLoadable(undefined)).toBe(false);
  });
});
