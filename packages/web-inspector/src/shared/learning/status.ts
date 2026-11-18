import type { InspectorLearningSnapshotV1 } from "@copilotkit/shared";

/** What the Inspector can say about Learning on the attached runtime. */
export type LearningStatus =
  | "configured"
  | "not_configured"
  | "unavailable"
  | "checking";

/** A failed or pending read must never imply that Learning is disabled. */
export function deriveLearningStatus(input: {
  readonly error: string | null;
  readonly supported: boolean;
  readonly snapshot: InspectorLearningSnapshotV1 | null;
}): LearningStatus {
  if (input.error) return "unavailable";
  if (input.supported && !input.snapshot) return "checking";
  return input.snapshot?.configuration.state === "configured"
    ? "configured"
    : "not_configured";
}

/** Whether the status is not known yet, so the UI offers a retry. */
export function isLearningStatusPending(status: LearningStatus): boolean {
  return status === "unavailable" || status === "checking";
}
