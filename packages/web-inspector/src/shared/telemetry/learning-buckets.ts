export type InspectorLearningCountBucket =
  | "zero"
  | "one"
  | "two_to_five"
  | "six_to_twenty"
  | "twenty_one_plus";
export type InspectorLearningDurationBucket =
  | "under_250ms"
  | "250ms_to_1s"
  | "1s_to_3s"
  | "3s_plus";

export function learningCountBucket(
  value: number,
): InspectorLearningCountBucket {
  if (value <= 0) return "zero";
  if (value === 1) return "one";
  if (value <= 5) return "two_to_five";
  if (value <= 20) return "six_to_twenty";
  return "twenty_one_plus";
}

export function learningDurationBucket(
  durationMs: number,
): InspectorLearningDurationBucket {
  if (durationMs < 250) return "under_250ms";
  if (durationMs < 1_000) return "250ms_to_1s";
  if (durationMs < 3_000) return "1s_to_3s";
  return "3s_plus";
}
