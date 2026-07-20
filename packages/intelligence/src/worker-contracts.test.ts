import { expect, test } from "vitest";
import * as intelligence from "./index.js";

const runId = "88888888-8888-4888-8888-888888888888";
const attemptId = "22222222-2222-4222-8222-222222222222";
const snapshotId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sha256 = "a".repeat(64);
const now = "2026-07-16T18:00:00.000Z";

const commandEnvelope = {
  schemaVersion: 1,
  requestId: "request_1",
  traceId: "trace_1",
} as const;

const selectedSnapshot = {
  snapshotId,
  contentSha256: sha256,
  containerSequence: 1,
};

const chunk = {
  learningRunId: runId,
  attemptId,
  chunkIndex: 0,
  snapshotRange: {
    firstSnapshotId: snapshotId,
    lastSnapshotId: snapshotId,
    firstSequence: 1,
    lastSequence: 1,
  },
  inputSha256: sha256,
  outputSha256: null,
  status: "planned",
  privatePayloadRef: {},
  createdAt: now,
  updatedAt: now,
} as const;

const workflowOutput = {
  schemaVersion: 1,
  insights: [],
  skillCandidates: [],
  coverage: {},
  rejections: [],
  usage: {},
} as const;

type RuntimeSchema = {
  safeParse(value: unknown): { success: boolean };
};

function exportedSchema(name: string): RuntimeSchema {
  const schema = (intelligence as Record<string, unknown>)[name];
  expect(
    schema,
    `${name} must be exported from the package root`,
  ).toBeDefined();
  return schema as RuntimeSchema;
}

test("exports the producer worker lifecycle schemas from the package root", () => {
  expect(Object.keys(intelligence)).toEqual(
    expect.arrayContaining([
      "createLearningRunV1Schema",
      "learningRunJobV1Schema",
      "learningRunExecutionResultV1Schema",
      "appendLearningRunChunkV1Schema",
    ]),
  );
});

test("CreateLearningRunV1 freezes the complete manifest and rejects inverted sequence bounds", () => {
  const schema = exportedSchema("createLearningRunV1Schema");
  const command = {
    ...commandEnvelope,
    learningRunId: runId,
    organizationId: "org_1",
    projectId: "project_1",
    learningContainerId: "55555555-5555-4555-8555-555555555555",
    trigger: "manual",
    idempotencyKey: "run_1",
    selectedAfterSequence: 0,
    selectedThroughSequence: 1,
    snapshotIdsAndHashes: [selectedSnapshot],
    selectedAnnotations: [],
    registryRevision: "revision_1",
    skillSetHash: sha256,
    containerConfigRevision: 1,
    modelProfileRef: "model:v1",
    promptProfileRef: "prompt:v1",
    evaluatorProfileRef: "evaluator:v1",
    workflowVersion: "workflow:v1",
    normalizerVersion: "normalizer:v1",
    sanitizerVersion: "sanitizer:v1",
    manifestSha256: sha256,
  } as const;

  expect(schema.safeParse(command).success).toBe(true);
  expect(
    schema.safeParse({
      ...command,
      selectedAfterSequence: 2,
      selectedThroughSequence: 1,
      snapshotIdsAndHashes: [],
    }).success,
  ).toBe(false);
});

test("LearningRunJobV1 carries only the durable attempt fence", () => {
  const schema = exportedSchema("learningRunJobV1Schema");
  const job = {
    ...commandEnvelope,
    learningRunId: runId,
    attemptId,
    fenceGeneration: 0,
  } as const;

  expect(schema.safeParse(job).success).toBe(true);
  expect(schema.safeParse({ ...job, fenceGeneration: -1 }).success).toBe(false);
});

test("LearningRunExecutionResultV1 validates chunks and aggregate workflow output", () => {
  const schema = exportedSchema("learningRunExecutionResultV1Schema");
  const result = {
    outputSha256: sha256,
    chunks: [chunk],
    workflowOutput,
  } as const;

  expect(schema.safeParse(result).success).toBe(true);
  expect(schema.safeParse({ ...result, outputSha256: "short" }).success).toBe(
    false,
  );
});

test("AppendLearningRunChunkV1 binds chunk identity to its attempt envelope", () => {
  const schema = exportedSchema("appendLearningRunChunkV1Schema");
  const command = {
    ...commandEnvelope,
    learningRunId: runId,
    attemptId,
    fenceGeneration: 0,
    chunkIndex: 0,
    chunk,
  } as const;

  expect(schema.safeParse(command).success).toBe(true);
  expect(schema.safeParse({ ...command, chunkIndex: 1 }).success).toBe(false);
});
