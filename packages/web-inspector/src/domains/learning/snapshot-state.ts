import type { InspectorLearningSnapshotV1 } from "@copilotkit/shared";

export type LearningViewState =
  | "loading"
  | "error"
  | "selection_required"
  | "invalid"
  | "results"
  | "first_run"
  | "ready"
  | "empty"
  | "setup"
  | "landing";

export function deriveLearningViewState(input: {
  readonly supported: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly snapshot: InspectorLearningSnapshotV1 | null;
  readonly setupActive: boolean;
}): LearningViewState {
  // A Runtime that has not opted into Learning is still a valid product
  // onboarding state. The parent Inspector renders the Learning preview for
  // `landing`; after the setup prompt is copied, keep the user in the setup
  // flow while the Runtime is updated and reconnects.
  if (!input.supported) return input.setupActive ? "setup" : "landing";
  if (!input.snapshot && input.loading) return "loading";
  if (!input.snapshot && input.error) return "error";
  const snapshot = input.snapshot;
  if (!snapshot) return "loading";
  if (snapshot.configuration.state === "selection_required")
    return "selection_required";
  if (snapshot.configuration.state === "invalid") return "invalid";
  const hasResults =
    snapshot.skillsPage.total > 0 || snapshot.insightsPage.total > 0;
  if (hasResults || snapshot.pendingCandidateCount > 0) return "results";
  if (snapshot.run.hasActiveRun) return "first_run";
  if (snapshot.run.hasEverSucceeded && snapshot.pendingThreadCount === 0)
    return "empty";
  if (
    snapshot.configuration.state === "configured" &&
    snapshot.pendingThreadCount > 0
  )
    return "ready";
  if (input.setupActive || snapshot.configuration.state === "configured")
    return "setup";
  return "landing";
}
