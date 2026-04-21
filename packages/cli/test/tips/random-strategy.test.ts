import { describe, test, expect } from "@jest/globals";
import { RandomStrategy } from "../../src/tips/strategies/random.js";
import type { Tip, TipState } from "../../src/tips/types.js";

const tips: Tip[] = [
  { id: "a", message: "Tip A" },
  { id: "b", message: "Tip B" },
  { id: "c", message: "Tip C" },
];

const emptyState: TipState = { shownTipIds: [] };

describe("RandomStrategy", () => {
  test("returns a tip from the pool", () => {
    const strategy = new RandomStrategy();
    const tip = strategy.select(tips, emptyState);
    expect(tip).not.toBeNull();
    expect(tips.map((t) => t.id)).toContain(tip!.id);
  });

  test("returns null for empty tip array", () => {
    const strategy = new RandomStrategy();
    const tip = strategy.select([], emptyState);
    expect(tip).toBeNull();
  });

  test("ignores state (stateless)", () => {
    const strategy = new RandomStrategy();
    const stateWithHistory: TipState = {
      shownTipIds: ["a", "b", "c"],
      lastShownAt: "2026-04-21T00:00:00.000Z",
    };
    const tip = strategy.select(tips, stateWithHistory);
    expect(tip).not.toBeNull();
  });
});
