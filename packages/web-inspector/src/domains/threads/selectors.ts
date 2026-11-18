import type { ɵThread } from "@copilotkit/core";
import type { ThreadsState } from "./state.js";

export type ThreadServiceStatus =
  | "available"
  | "unavailable"
  | "unknown"
  | "error";

export interface ActiveThreadsState {
  displayThreads: ɵThread[];
  threadsErrorMessage: string | null;
  threadsLoading: boolean;
}

export interface VisibleRealThreadCandidate {
  readonly id: string;
  readonly updatedAt?: string | null;
  readonly createdAt?: string | null;
}

export interface SelectVisibleRealThreadInput {
  readonly threads: readonly VisibleRealThreadCandidate[];
  readonly selectedThreadId: string | null;
}

type ThreadEndpointsSource = {
  threadEndpoints?: { list?: boolean } | null;
} | null;

/** Keep one row per thread id while preserving the first-seen order. */
export function uniqueThreadsById(threads: readonly ɵThread[]): ɵThread[] {
  const seen = new Set<string>();
  const unique: ɵThread[] = [];
  for (const thread of threads) {
    if (seen.has(thread.id)) {
      continue;
    }
    seen.add(thread.id);
    unique.push(thread);
  }
  return unique;
}

export function selectActiveThreads(
  threadsByAgent: ReadonlyMap<string, ɵThread[]>,
  selectedContext: string,
): ɵThread[] {
  if (selectedContext !== "all-agents") {
    return threadsByAgent.get(selectedContext) ?? [];
  }

  return uniqueThreadsById(Array.from(threadsByAgent.values()).flat());
}

export function areThreadEndpointsAvailable(
  core: ThreadEndpointsSource,
): boolean {
  const endpoints = core?.threadEndpoints;
  return (
    endpoints !== null &&
    typeof endpoints === "object" &&
    endpoints.list !== false
  );
}

export function getThreadServiceStatus(
  core: ThreadEndpointsSource,
): ThreadServiceStatus {
  if (!core || !core.threadEndpoints) return "unknown";
  return core.threadEndpoints.list === false ? "unavailable" : "available";
}

export function selectActiveThreadsState(
  state: ThreadsState,
  selectedContext: string,
): ActiveThreadsState {
  const displayThreads =
    selectedContext === "all-agents"
      ? state.threads
      : selectActiveThreads(state.threadsByAgent, selectedContext);
  const threadsErrorMessage =
    selectedContext === "all-agents"
      ? (state.threadsErrorByAgent.values().next().value?.message ?? null)
      : (state.threadsErrorByAgent.get(selectedContext)?.message ?? null);
  const threadsLoading =
    selectedContext === "all-agents"
      ? Array.from(state.threadsLoadingByAgent.values()).some(Boolean)
      : (state.threadsLoadingByAgent.get(selectedContext) ?? false);

  return { displayThreads, threadsErrorMessage, threadsLoading };
}

export function hasVisibleSettledRealThreads(
  active: ActiveThreadsState,
): boolean {
  return (
    !active.threadsErrorMessage &&
    !active.threadsLoading &&
    active.displayThreads.length > 0
  );
}

export function shouldRenderExampleThreads(
  locked: boolean,
  active: ActiveThreadsState,
): boolean {
  return (
    locked ||
    (!active.threadsErrorMessage &&
      !active.threadsLoading &&
      active.displayThreads.length === 0)
  );
}

export function selectRealThread(
  threads: readonly ɵThread[],
  selectedThreadId: string | null,
  selectedLocalExampleThreadId: string | null,
): ɵThread | null {
  if (!selectedThreadId || selectedThreadId === selectedLocalExampleThreadId) {
    return null;
  }
  return threads.find((thread) => thread.id === selectedThreadId) ?? null;
}

function parsedTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareNewestDate(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const leftTimestamp = parsedTimestamp(left);
  const rightTimestamp = parsedTimestamp(right);
  if (leftTimestamp === null) return rightTimestamp === null ? 0 : 1;
  if (rightTimestamp === null) return -1;
  if (leftTimestamp === rightTimestamp) return 0;
  return leftTimestamp > rightTimestamp ? -1 : 1;
}

function compareVisibleThreads(
  left: VisibleRealThreadCandidate,
  right: VisibleRealThreadCandidate,
): number {
  const updatedOrder = compareNewestDate(left.updatedAt, right.updatedAt);
  if (updatedOrder !== 0) return updatedOrder;
  const createdOrder = compareNewestDate(left.createdAt, right.createdAt);
  if (createdOrder !== 0) return createdOrder;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

export function selectVisibleRealThreadId(
  input: SelectVisibleRealThreadInput,
): string | null {
  if (
    input.selectedThreadId !== null &&
    input.threads.some((thread) => thread.id === input.selectedThreadId)
  ) {
    return input.selectedThreadId;
  }
  return [...input.threads].sort(compareVisibleThreads)[0]?.id ?? null;
}
