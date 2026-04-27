import { describe, test, expect } from "@jest/globals";
import { SequentialStrategy } from "../../src/tips/strategies/sequential.js";
import type { Tip, TipState } from "../../src/tips/types.js";

const tips: Tip[] = [
  { id: "a", message: "Tip A" },
  { id: "b", message: "Tip B" },
  { id: "c", message: "Tip C" },
];

describe("SequentialStrategy", () => {
  test("returns first tip when no history", () => {
    const strategy = new SequentialStrategy();
    const tip = strategy.select(tips, { shownTipIds: [] });
    expect(tip).toEqual(tips[0]);
  });

  test("returns next tip after the last shown", () => {
    const strategy = new SequentialStrategy();
    const tip = strategy.select(tips, { shownTipIds: ["a"] });
    expect(tip).toEqual(tips[1]);
  });

  test("wraps around to first tip after last", () => {
    const strategy = new SequentialStrategy();
    const tip = strategy.select(tips, { shownTipIds: ["a", "b", "c"] });
    expect(tip).toEqual(tips[0]);
  });

  test("uses last entry in shownTipIds to determine position", () => {
    const strategy = new SequentialStrategy();
    const tip = strategy.select(tips, { shownTipIds: ["c", "a", "b"] });
    expect(tip).toEqual(tips[2]); // after "b" (index 1) → "c" (index 2)
  });

  test("returns first tip if last shown id is not in current tips", () => {
    const strategy = new SequentialStrategy();
    const tip = strategy.select(tips, { shownTipIds: ["unknown"] });
    expect(tip).toEqual(tips[0]);
  });

  test("returns null for empty tip array", () => {
    const strategy = new SequentialStrategy();
    const tip = strategy.select([], { shownTipIds: [] });
    expect(tip).toBeNull();
  });
});
