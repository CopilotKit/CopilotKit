import { describe, expect, it } from "vitest";

import { add, calculateCoverageSummary, subtract } from "./calculator.js";

describe("calculator fixture", () => {
  it("adds two values", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("subtracts two values", () => {
    expect(subtract(7, 4)).toBe(3);
  });

  it("returns a non-empty coverage summary", () => {
    expect(calculateCoverageSummary()).not.toHaveLength(0);
  });
});
