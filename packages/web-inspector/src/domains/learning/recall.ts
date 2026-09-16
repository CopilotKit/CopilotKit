import type { CopilotKitCore, Memory } from "@copilotkit/core";
import {
  beginRecall,
  completeRecall,
  failRecall,
  projectUnsupportedRecall,
} from "./state.js";
import type { LearningState } from "./state.js";

type RecallCore = {
  getMemoryStore?: CopilotKitCore["getMemoryStore"];
};

export function normalizeRelevance(
  score: number | undefined,
  maxScore: number,
): number | undefined {
  if (maxScore <= 0) return undefined;
  if (score === undefined || !Number.isFinite(score)) return undefined;
  const ratio = score / maxScore;
  if (ratio <= 0) return 0;
  return ratio > 1 ? 1 : ratio;
}

export function maxRecallScore(memories: readonly Memory[]): number {
  let max = 0;
  for (const memory of memories) {
    const score = memory.score;
    if (typeof score === "number" && Number.isFinite(score) && score > max) {
      max = score;
    }
  }
  return max;
}

export function relevanceBarWidth(relevance: number): number {
  return Math.max(6, Math.min(100, Math.round(relevance * 100)));
}

export function runLearningRecall(
  state: LearningState,
  core: RecallCore | null,
  query: string,
  requestUpdate: () => void,
): void {
  const trimmed = query.trim();
  if (trimmed.length === 0) return;

  const store = core?.getMemoryStore?.();
  if (!store || typeof store.recall !== "function") {
    projectUnsupportedRecall(state);
    requestUpdate();
    return;
  }

  const request = beginRecall(state, trimmed);
  requestUpdate();
  void store
    .recall(trimmed)
    .then((results) => {
      if (completeRecall(state, request, results)) requestUpdate();
    })
    .catch((error: unknown) => {
      if (failRecall(state, request, error)) requestUpdate();
    });
}
