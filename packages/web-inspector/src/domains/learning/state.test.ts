import type { Memory } from "@copilotkit/core";
import { describe, expect, it } from "vitest";
import {
  beginRecall,
  clearRecall,
  completeRecall,
  createLearningState,
} from "./state.js";

const result: Memory = {
  id: "memory-1",
  kind: "topical",
  scope: "user",
  content: "Prefers concise answers",
  sourceThreadIds: [],
  invalidatedAt: null,
};

describe("Learning recall state", () => {
  it("ignores a stale recall result after a newer query starts", () => {
    const state = createLearningState();
    const staleRequest = beginRecall(state, "first");
    const currentRequest = beginRecall(state, "second");

    expect(completeRecall(state, staleRequest, [result])).toBe(false);
    expect(completeRecall(state, currentRequest, [result])).toBe(true);
    expect(state.recallQuery).toBe("second");
    expect(state.recallResults).toEqual([result]);
  });

  it("invalidates an in-flight recall when results are cleared", () => {
    const state = createLearningState();
    const request = beginRecall(state, "query");

    clearRecall(state);

    expect(completeRecall(state, request, [result])).toBe(false);
    expect(state.recallResults).toBeNull();
    expect(state.recallQuery).toBe("");
  });
});
