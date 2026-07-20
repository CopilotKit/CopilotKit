import { expect, test } from "vitest";
import {
  LEARNING_PLATFORM_ERROR_CODES,
  learningPlatformErrorResponseV1Schema,
} from "./errors.js";

const intelligenceProducerErrorCodes = [
  "LEARNING_CONTAINER_NOT_FOUND",
  "LEARNING_CONTAINER_ARCHIVED",
  "LEARNING_CONTAINER_PROJECT_MISMATCH",
  "LEARNING_CONTAINER_CONFIG_CONFLICT",
  "LEARNING_CONTAINER_ASSIGNMENT_MISMATCH",
  "LEARNING_CONTAINER_ASSIGNMENT_CONFLICT",
  "LEARNING_RUN_ACTIVE_CONFLICT",
  "LEARNING_RUN_IDEMPOTENCY_CONFLICT",
  "LEARNING_RUN_NOT_FOUND",
  "LEARNING_ATTEMPT_FENCE_REJECTED",
  "LEARNING_SNAPSHOT_INVARIANT_VIOLATION",
  "LEARNING_REGISTRY_STALE_PARENT",
  "LEARNING_REGISTRY_SUBJECT_MISMATCH",
  "LEARNING_REGISTRY_GATES_INCOMPLETE",
  "LEARNING_REGISTRY_CONFLICT",
  "LEARNING_REGISTRY_UNRECOVERABLE",
  "LEARNING_CANDIDATE_NOT_FOUND",
  "LEARNING_CANDIDATE_REVISION_CONFLICT",
  "LEARNING_CANDIDATE_NOT_REVIEWABLE",
  "LEARNING_BLOB_INTEGRITY_MISMATCH",
  "LEARNING_BLOB_INTEGRITY_FAILURE",
  "LEARNING_SDK_CACHE_CORRUPT",
] as const;

test("learning assignment mismatch has a stable typed error code", () => {
  expect(LEARNING_PLATFORM_ERROR_CODES).toContain(
    "LEARNING_CONTAINER_ASSIGNMENT_MISMATCH",
  );
});

test("LearningPlatformErrorResponseV1 carries registry metadata and correlation IDs", () => {
  const response = {
    error: {
      code: "LEARNING_CONTAINER_ASSIGNMENT_MISMATCH",
      message:
        "Existing thread assignment does not match the asserted container.",
      category: "conflict",
      retryable: false,
    },
    requestId: "req_1",
    traceId: "trace_1",
  } as const;

  expect(learningPlatformErrorResponseV1Schema.parse(response)).toEqual(
    response,
  );
  expect(
    learningPlatformErrorResponseV1Schema.safeParse({
      ...response,
      error: { ...response.error, code: "UNKNOWN" },
    }).success,
  ).toBe(false);
});

test("accepts every stable error envelope emitted by the Intelligence producer", () => {
  expect(LEARNING_PLATFORM_ERROR_CODES).toEqual(intelligenceProducerErrorCodes);

  for (const code of intelligenceProducerErrorCodes) {
    expect(
      learningPlatformErrorResponseV1Schema.safeParse({
        error: {
          code,
          message: "Stable Intelligence producer error.",
          category: "conflict",
          retryable: false,
        },
        requestId: "req_producer",
        traceId: "trace_producer",
      }).success,
      code,
    ).toBe(true);
  }
});

test.each([
  "LEARNING_CANDIDATE_STALE_PARENT",
  "LEARNING_CANDIDATE_SUBJECT_MISMATCH",
  "LEARNING_CANDIDATE_GATES_INCOMPLETE",
])("rejects the obsolete producer error alias %s", (code) => {
  expect(
    learningPlatformErrorResponseV1Schema.safeParse({
      error: {
        code,
        message: "Obsolete error alias.",
        category: "conflict",
        retryable: false,
      },
      requestId: "req_alias",
      traceId: "trace_alias",
    }).success,
  ).toBe(false);
});
