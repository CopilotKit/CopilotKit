import type { ThreadsState, ExampleKind } from "../state.js";
import type { ThreadServiceStatus } from "../selectors.js";

export type ThreadsViewState = "locked" | "empty_enabled" | "enabled";

export function claimThreadsViewState(
  state: ThreadsState,
  viewState: ThreadsViewState,
  serviceStatus: ThreadServiceStatus,
): boolean {
  const key = `${viewState}:${serviceStatus}`;
  if (state.viewedThreadsTelemetryStates.has(key)) return false;
  state.viewedThreadsTelemetryStates.add(key);
  return true;
}

export function claimExampleViewed(
  state: ThreadsState,
  exampleKind: ExampleKind,
): boolean {
  if (state.viewedExampleKinds.has(exampleKind)) return false;
  state.viewedExampleKinds.add(exampleKind);
  return true;
}

export function claimExampleSelected(
  state: ThreadsState,
  exampleKind: ExampleKind,
): boolean {
  if (state.selectedExampleKinds.has(exampleKind)) return false;
  state.selectedExampleKinds.add(exampleKind);
  return true;
}

export function claimExampleTourStep(
  state: ThreadsState,
  exampleKind: ExampleKind,
  tourStep: number,
): boolean {
  const key = `${exampleKind}:${tourStep}`;
  if (state.viewedExampleTourSteps.has(key)) return false;
  state.viewedExampleTourSteps.add(key);
  return true;
}
