import {
  getTelemetryDistinctIdForUrl,
  trackMemoriesTabClicked,
} from "../../shared/telemetry/privacy.js";
import type { InspectorMemoryTelemetryProps } from "../../shared/telemetry/privacy.js";
import type { LearningState } from "./state.js";

export function getLearningTelemetryProps(
  state: LearningState,
  telemetryDisabled: boolean | undefined,
): InspectorMemoryTelemetryProps {
  const distinctId = telemetryDisabled ? null : getTelemetryDistinctIdForUrl();
  return {
    posthog_distinct_id: distinctId ?? undefined,
    memory_count: state.memories.length,
    available: state.memoriesAvailable,
  };
}

export function trackLearningTabClicked(
  state: LearningState,
  telemetryDisabled: boolean | undefined,
): void {
  if (telemetryDisabled) return;
  trackMemoriesTabClicked(getLearningTelemetryProps(state, telemetryDisabled));
}
