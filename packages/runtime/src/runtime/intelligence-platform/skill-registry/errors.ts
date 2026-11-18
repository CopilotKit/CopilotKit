import { LearnedSkillsError } from "../learned-skills";

// Reuse the canonical delivery error identity across transport and adapter code.
export { LearnedSkillsError as SkillDeliveryError } from "../learned-skills";
export type { LearnedSkillsErrorCode as SkillDeliveryErrorCode } from "../learned-skills";

export function invalidSnapshot(cause?: unknown): LearnedSkillsError {
  return new LearnedSkillsError("INVALID_SNAPSHOT", false, cause);
}
