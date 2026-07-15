import { describe, it, expect } from "vitest";
import type { Memory } from "@copilotkit/core";
import {
  ɵnormalizeRelevance,
  ɵmaxRecallScore,
  ɵrelevanceBarWidth,
} from "../index.js";

function mem(id: string, score?: number): Memory {
  return {
    id,
    kind: "topical",
    scope: "user",
    content: `content ${id}`,
    sourceThreadIds: [],
    invalidatedAt: null,
    ...(score !== undefined ? { score } : {}),
  } as Memory;
}

describe("ɵmaxRecallScore", () => {
  it("returns 0 for an empty set", () => {
    expect(ɵmaxRecallScore([])).toBe(0);
  });
  it("returns 0 when no memory carries a score", () => {
    expect(ɵmaxRecallScore([mem("a"), mem("b")])).toBe(0);
  });
  it("returns the largest finite score", () => {
    expect(ɵmaxRecallScore([mem("a", 0.2), mem("b", 0.9), mem("c", 0.5)])).toBe(
      0.9,
    );
  });
  it("ignores non-finite scores", () => {
    expect(
      ɵmaxRecallScore([
        mem("a", Number.NaN),
        mem("b", Infinity),
        mem("c", 0.3),
      ]),
    ).toBe(0.3);
  });
});

describe("ɵnormalizeRelevance", () => {
  it("returns undefined when maxScore is non-positive", () => {
    expect(ɵnormalizeRelevance(0.5, 0)).toBeUndefined();
    expect(ɵnormalizeRelevance(0.5, -1)).toBeUndefined();
  });
  it("returns undefined when the score is missing or non-finite", () => {
    expect(ɵnormalizeRelevance(undefined, 1)).toBeUndefined();
    expect(ɵnormalizeRelevance(Number.NaN, 1)).toBeUndefined();
  });
  it("normalizes against the set max", () => {
    expect(ɵnormalizeRelevance(0.45, 0.9)).toBeCloseTo(0.5, 5);
    expect(ɵnormalizeRelevance(0.9, 0.9)).toBe(1);
  });
  it("clamps into [0, 1]", () => {
    expect(ɵnormalizeRelevance(2, 1)).toBe(1);
    expect(ɵnormalizeRelevance(-0.3, 1)).toBe(0);
  });
});

describe("ɵrelevanceBarWidth", () => {
  it("floors at 6 for weak-but-matched results", () => {
    expect(ɵrelevanceBarWidth(0)).toBe(6);
    expect(ɵrelevanceBarWidth(0.01)).toBe(6);
  });
  it("rounds the percentage", () => {
    expect(ɵrelevanceBarWidth(0.5)).toBe(50);
    expect(ɵrelevanceBarWidth(0.734)).toBe(73);
  });
  it("caps at 100", () => {
    expect(ɵrelevanceBarWidth(1)).toBe(100);
    expect(ɵrelevanceBarWidth(1.5)).toBe(100);
  });
});
