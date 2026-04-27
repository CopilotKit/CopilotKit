import { describe, test, expect } from "@jest/globals";
import { WeightedRandomStrategy } from "../../src/tips/strategies/weighted-random.js";
import type { Tip, TipState } from "../../src/tips/types.js";

const tips: Tip[] = [
  { id: "a", message: "Tip A", weight: 1 },
  { id: "b", message: "Tip B", weight: 2 },
  { id: "c", message: "Tip C", weight: 1 },
];

const emptyState: TipState = { shownTipIds: [] };

describe("WeightedRandomStrategy", () => {
  test("returns a tip from the pool", () => {
    const strategy = new WeightedRandomStrategy();
    const tip = strategy.select(tips, emptyState);
    expect(tip).not.toBeNull();
    expect(tips.map((t) => t.id)).toContain(tip!.id);
  });

  test("returns null for empty tip array", () => {
    const strategy = new WeightedRandomStrategy();
    const tip = strategy.select([], emptyState);
    expect(tip).toBeNull();
  });

  test("defaults weight to 1 when not specified", () => {
    const unweightedTips: Tip[] = [
      { id: "x", message: "X" },
      { id: "y", message: "Y" },
    ];
    const strategy = new WeightedRandomStrategy();
    const tip = strategy.select(unweightedTips, emptyState);
    expect(tip).not.toBeNull();
  });

  test("respects noRepeatCount — skips recently shown tips", () => {
    const strategy = new WeightedRandomStrategy({ noRepeatCount: 2 });
    const state: TipState = { shownTipIds: ["a", "b"] };
    // With a and b excluded and only c available, must return c
    const tip = strategy.select(tips, state);
    expect(tip!.id).toBe("c");
  });

  test("returns null when all tips are excluded by noRepeatCount", () => {
    const strategy = new WeightedRandomStrategy({ noRepeatCount: 3 });
    const state: TipState = { shownTipIds: ["a", "b", "c"] };
    const tip = strategy.select(tips, state);
    expect(tip).toBeNull();
  });

  test("only excludes the last N shown, not older ones", () => {
    const strategy = new WeightedRandomStrategy({ noRepeatCount: 1 });
    const state: TipState = { shownTipIds: ["a", "b", "c"] };
    // Only "c" (last 1) is excluded, so "a" or "b" can be picked
    const tip = strategy.select(tips, state);
    expect(tip).not.toBeNull();
    expect(["a", "b"]).toContain(tip!.id);
  });

  test("higher weight tips are selected more often (statistical)", () => {
    const strategy = new WeightedRandomStrategy();
    const heavyTips: Tip[] = [
      { id: "light", message: "Light", weight: 1 },
      { id: "heavy", message: "Heavy", weight: 100 },
    ];
    const counts: Record<string, number> = { light: 0, heavy: 0 };
    for (let i = 0; i < 200; i++) {
      const tip = strategy.select(heavyTips, emptyState);
      counts[tip!.id]++;
    }
    // With 100:1 weighting, "heavy" should dominate
    expect(counts.heavy).toBeGreaterThan(counts.light);
  });
});
