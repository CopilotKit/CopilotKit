import type { Memory, MemoryRealtimeStatus } from "@copilotkit/core";

export interface LearningState {
  memories: Memory[];
  memoriesLoading: boolean;
  memoriesError: Error | null;
  memoriesAvailable: boolean;
  memoriesRealtimeStatus: MemoryRealtimeStatus;
  memoryUnsubscribe: (() => void) | null;
  memorySubscribed: boolean;
  memoryStoreUnsupported: boolean;
  recallResults: Memory[] | null;
  recallLoading: boolean;
  recallError: string | null;
  recallQuery: string;
  recallSequence: number;
}

export function createLearningState(): LearningState {
  return {
    memories: [],
    memoriesLoading: false,
    memoriesError: null,
    memoriesAvailable: true,
    memoriesRealtimeStatus: "connecting",
    memoryUnsubscribe: null,
    memorySubscribed: false,
    memoryStoreUnsupported: false,
    recallResults: null,
    recallLoading: false,
    recallError: null,
    recallQuery: "",
    recallSequence: 0,
  };
}

export function setRecallQuery(state: LearningState, query: string): void {
  state.recallQuery = query;
}

export function beginRecall(state: LearningState, query: string): number {
  state.recallSequence += 1;
  state.recallQuery = query;
  state.recallLoading = true;
  state.recallError = null;
  return state.recallSequence;
}

export function completeRecall(
  state: LearningState,
  request: number,
  results: Memory[],
): boolean {
  if (request !== state.recallSequence) return false;
  state.recallResults = results;
  state.recallError = null;
  state.recallLoading = false;
  return true;
}

export function failRecall(
  state: LearningState,
  request: number,
  error: unknown,
): boolean {
  if (request !== state.recallSequence) return false;
  state.recallResults = [];
  state.recallError = error instanceof Error ? error.message : "unknown error";
  state.recallLoading = false;
  return true;
}

export function projectUnsupportedRecall(state: LearningState): void {
  state.recallResults = [];
  state.recallError = "Recall is not supported by this SDK version.";
  state.recallLoading = false;
}

export function clearRecall(state: LearningState): void {
  state.recallSequence += 1;
  state.recallResults = null;
  state.recallError = null;
  state.recallLoading = false;
  state.recallQuery = "";
}

export function resetLearningState(state: LearningState): void {
  state.memoryUnsubscribe?.();
  state.memoryUnsubscribe = null;
  state.memories = [];
  state.memoriesLoading = false;
  state.memoriesError = null;
  state.memoriesAvailable = true;
  state.memoriesRealtimeStatus = "connecting";
  state.memorySubscribed = false;
  state.memoryStoreUnsupported = false;
  clearRecall(state);
}
