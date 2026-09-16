import { LearnedSkillsError } from "@copilotkit/runtime/v2";

// Reuse the canonical delivery error identity across transport and adapter code.
export { LearnedSkillsError as SkillDeliveryError } from "@copilotkit/runtime/v2";
export type { LearnedSkillsErrorCode as SkillDeliveryErrorCode } from "@copilotkit/runtime/v2";

export function invalidSnapshot(cause?: unknown): LearnedSkillsError {
  return new LearnedSkillsError("INVALID_SNAPSHOT", false, cause);
}
