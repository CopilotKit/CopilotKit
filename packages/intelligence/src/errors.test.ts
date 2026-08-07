import { expect, test } from "vitest";
import {
  LEARNING_PLATFORM_ERROR_CODES,
  learningPlatformErrorResponseV1Schema,
} from "./errors.js";

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
