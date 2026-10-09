import type { Memory } from "@copilotkit/core";
import { describe, expect, it } from "vitest";
import {
  ɵmaxRecallScore as maxRecallScore,
  ɵnormalizeRelevance as normalizeRelevance,
  ɵrelevanceBarWidth as relevanceBarWidth,
} from "../../index.js";

function memory(id: string, score?: number): Memory {
  return {
    id,
    kind: "topical",
    scope: "user",
    content: `content ${id}`,
    sourceThreadIds: [],
    invalidatedAt: null,
    ...(score !== undefined ? { score } : {}),
  };
}

describe("maxRecallScore", () => {
  it("returns 0 for an empty set", () => {
    expect(maxRecallScore([])).toBe(0);
  });

  it("returns 0 when no memory carries a score", () => {
    expect(maxRecallScore([memory("a"), memory("b")])).toBe(0);
  });

  it("returns the largest finite score", () => {
    expect(
      maxRecallScore([memory("a", 0.2), memory("b", 0.9), memory("c", 0.5)]),
    ).toBe(0.9);
  });

  it("ignores non-finite scores", () => {
    expect(
      maxRecallScore([
        memory("a", Number.NaN),
        memory("b", Infinity),
        memory("c", 0.3),
      ]),
    ).toBe(0.3);
  });
});

describe("normalizeRelevance", () => {
  it("returns undefined when maxScore is non-positive", () => {
    expect(normalizeRelevance(0.5, 0)).toBeUndefined();
    expect(normalizeRelevance(0.5, -1)).toBeUndefined();
  });

  it("returns undefined when the score is missing or non-finite", () => {
    expect(normalizeRelevance(undefined, 1)).toBeUndefined();
    expect(normalizeRelevance(Number.NaN, 1)).toBeUndefined();
  });

  it("normalizes against the set maximum", () => {
    expect(normalizeRelevance(0.45, 0.9)).toBeCloseTo(0.5, 5);
    expect(normalizeRelevance(0.9, 0.9)).toBe(1);
  });

  it("clamps into [0, 1]", () => {
    expect(normalizeRelevance(2, 1)).toBe(1);
    expect(normalizeRelevance(-0.3, 1)).toBe(0);
  });
});

describe("relevanceBarWidth", () => {
  it("floors at 6 for weak-but-matched results", () => {
    expect(relevanceBarWidth(0)).toBe(6);
    expect(relevanceBarWidth(0.01)).toBe(6);
  });

  it("rounds the percentage", () => {
    expect(relevanceBarWidth(0.5)).toBe(50);
    expect(relevanceBarWidth(0.734)).toBe(73);
  });

  it("caps at 100", () => {
    expect(relevanceBarWidth(1)).toBe(100);
    expect(relevanceBarWidth(1.5)).toBe(100);
  });
});
