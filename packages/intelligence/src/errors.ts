import { z } from "zod/v4";

/** Stable error identifiers shared by control-plane, runtime, workers, and SDKs. */
export const LEARNING_PLATFORM_ERROR_CODES = [
  "LEARNING_CONTAINER_NOT_FOUND",
  "LEARNING_CONTAINER_ARCHIVED",
  "LEARNING_CONTAINER_PROJECT_MISMATCH",
  "LEARNING_CONTAINER_CONFIG_CONFLICT",
  "LEARNING_CONTAINER_ASSIGNMENT_MISMATCH",
  "LEARNING_CONTAINER_ASSIGNMENT_CONFLICT",
  "LEARNING_RUN_ACTIVE_CONFLICT",
  "LEARNING_RUN_IDEMPOTENCY_CONFLICT",
  "LEARNING_ATTEMPT_FENCE_REJECTED",
  "LEARNING_SNAPSHOT_INVARIANT_VIOLATION",
  "LEARNING_CANDIDATE_STALE_PARENT",
  "LEARNING_CANDIDATE_SUBJECT_MISMATCH",
  "LEARNING_CANDIDATE_GATES_INCOMPLETE",
  "LEARNING_REGISTRY_CONFLICT",
  "LEARNING_REGISTRY_UNRECOVERABLE",
  "LEARNING_BLOB_INTEGRITY_FAILURE",
  "LEARNING_SDK_CACHE_CORRUPT",
] as const;

export const learningPlatformErrorCodeSchema = z.enum(
  LEARNING_PLATFORM_ERROR_CODES,
);
export type LearningPlatformErrorCode = z.infer<
  typeof learningPlatformErrorCodeSchema
>;

export const learningPlatformErrorCategorySchema = z.enum([
  "validation",
  "auth",
  "permission",
  "not_found",
  "conflict",
  "rate_limit",
  "internal",
  "dependency",
]);

/** Correlated REST error envelope used uniformly by Learning Platform APIs. */
export const learningPlatformErrorResponseV1Schema = z.looseObject({
  error: z.looseObject({
    code: learningPlatformErrorCodeSchema,
    message: z.string().min(1),
    category: learningPlatformErrorCategorySchema,
    retryable: z.boolean(),
  }),
  requestId: z.string().min(1),
  traceId: z.string().min(1),
});
export type LearningPlatformErrorResponseV1 = z.infer<
  typeof learningPlatformErrorResponseV1Schema
>;
