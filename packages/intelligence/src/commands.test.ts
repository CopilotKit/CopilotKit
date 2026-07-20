import { expect, test } from "vitest";
import {
  commitLearningRunResultV1Schema,
  evaluateCandidateGatesV1Schema,
  prepareRegistryCandidateV1Schema,
  publishCandidateV1Schema,
  requestThreadSnapshotBackfillV1Schema,
  startLearningContainerRunV1Schema,
} from "./commands.js";

const containerId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const candidateRevisionId = "44444444-4444-4444-8444-444444444444";
const sha256 = "a".repeat(64);
const nilUuid = "00000000-0000-0000-0000-000000000000";

test("StartLearningContainerRunV1 requires a scoped idempotent trigger", () => {
  const command = {
    schemaVersion: 1,
    organizationId: "org_1",
    projectId: "42",
    learningContainerId: containerId,
    trigger: "manual",
    idempotencyKey: "request_1",
    requestId: "req_1",
    traceId: "trace_1",
  } as const;

  expect(startLearningContainerRunV1Schema.safeParse(command).success).toBe(
    true,
  );
  expect(
    startLearningContainerRunV1Schema.safeParse({
      ...command,
      learningContainerId: nilUuid,
    }).success,
  ).toBe(false);
  expect(
    startLearningContainerRunV1Schema.safeParse({
      ...command,
      idempotencyKey: "",
    }).success,
  ).toBe(false);
});

test("CommitLearningRunResultV1 binds output to the active attempt fence", () => {
  const command = {
    schemaVersion: 1,
    learningRunId: runId,
    attemptId,
    fenceGeneration: 3,
    outputSha256: sha256,
    workflowOutput: {
      schemaVersion: 1,
      insights: [],
      skillCandidates: [],
      coverage: {},
      rejections: [],
      usage: {},
    },
    requestId: "req_1",
    traceId: "trace_1",
  } as const;

  expect(commitLearningRunResultV1Schema.safeParse(command).success).toBe(true);
  expect(
    commitLearningRunResultV1Schema.safeParse({
      ...command,
      fenceGeneration: -1,
    }).success,
  ).toBe(false);
});

test("PrepareRegistryCandidateV1 binds the command to its generated output alias", () => {
  const command = {
    schemaVersion: 1,
    learningRunId: runId,
    outputAlias: "candidate_1",
    idempotencyKey: "candidate_1",
    generatedCandidate: {
      outputAlias: "candidate_1",
      action: "add",
      skillId: null,
      parentVersionId: null,
      bundle: {
        rootDirectoryName: "candidate-skill",
        files: [
          {
            path: "SKILL.md",
            contentBase64: "IyBDYW5kaWRhdGU=",
          },
        ],
      },
      removalIntent: null,
      insightAliases: ["insight_1"],
      evidenceRefs: [],
      reason: "Repeated successful workflow pattern",
      risk: "low",
    },
    requestId: "req_1",
    traceId: "trace_1",
  } as const;

  expect(prepareRegistryCandidateV1Schema.safeParse(command).success).toBe(
    true,
  );
  expect(
    prepareRegistryCandidateV1Schema.safeParse({
      ...command,
      outputAlias: "candidate_2",
    }).success,
  ).toBe(false);
});

test("EvaluateCandidateGatesV1 and PublishCandidateV1 bind the same subject hash", () => {
  expect(
    evaluateCandidateGatesV1Schema.safeParse({
      schemaVersion: 1,
      candidateRevisionId,
      subjectSha256: sha256,
      evaluatorProfileRef: "evaluator:v1",
      requestId: "req_1",
      traceId: "trace_1",
    }).success,
  ).toBe(true);
  expect(
    publishCandidateV1Schema.safeParse({
      schemaVersion: 1,
      candidateRevisionId,
      subjectSha256: sha256,
      publicationIdempotencyKey: "publish_1",
      expectedParentVersionId: null,
      expectedArchiveFence: 0,
      requestId: "req_1",
      traceId: "trace_1",
    }).success,
  ).toBe(true);
  expect(
    publishCandidateV1Schema.safeParse({
      schemaVersion: 1,
      candidateRevisionId,
      subjectSha256: "short",
      publicationIdempotencyKey: "publish_1",
      expectedParentVersionId: null,
      expectedArchiveFence: 0,
      requestId: "req_1",
      traceId: "trace_1",
    }).success,
  ).toBe(false);
});

test("RequestThreadSnapshotBackfillV1 remains assignment-revision scoped and nullable", () => {
  expect(
    requestThreadSnapshotBackfillV1Schema.parse({
      schemaVersion: 1,
      organizationId: "org_1",
      projectId: "42",
      threadId: "thread_1",
      learningContainerId: null,
      assignmentRevision: 4,
      requestId: "req_1",
      traceId: "trace_1",
    }),
  ).toMatchObject({ learningContainerId: null, assignmentRevision: 4 });
});
