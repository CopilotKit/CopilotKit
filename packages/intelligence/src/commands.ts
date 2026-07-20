import { z } from "zod/v4";
import {
  generatedSkillCandidateV1Schema,
  jsonValueSchema,
  learningChunkV1Schema,
  learningWorkflowOutputV1Schema,
  selectedHumanAnnotationV1Schema,
  snapshotIdentityV1Schema,
  nonNilUuidSchema,
} from "./contracts.js";

const nonEmptyStringSchema = z.string().min(1);
const idSchema = nonEmptyStringSchema;
const uuidSchema = nonNilUuidSchema;
const nonNegativeIntegerSchema = z.int().nonnegative();
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, "Expected lowercase SHA-256");

const commandEnvelopeShape = {
  schemaVersion: z.literal(1),
  requestId: nonEmptyStringSchema,
  traceId: nonEmptyStringSchema,
} as const;

/** Freezes a new learning run and its complete deterministic manifest. */
export const createLearningRunV1Schema = z
  .looseObject({
    ...commandEnvelopeShape,
    learningRunId: uuidSchema,
    organizationId: idSchema,
    projectId: idSchema,
    learningContainerId: uuidSchema,
    trigger: z.enum(["nightly", "manual"]),
    idempotencyKey: nonEmptyStringSchema,
    selectedAfterSequence: nonNegativeIntegerSchema,
    selectedThroughSequence: nonNegativeIntegerSchema,
    snapshotIdsAndHashes: z.array(snapshotIdentityV1Schema),
    selectedAnnotations: z.array(selectedHumanAnnotationV1Schema),
    registryRevision: nonEmptyStringSchema,
    skillSetHash: sha256Schema,
    containerConfigRevision: nonNegativeIntegerSchema,
    modelProfileRef: nonEmptyStringSchema,
    promptProfileRef: nonEmptyStringSchema,
    evaluatorProfileRef: nonEmptyStringSchema,
    workflowVersion: nonEmptyStringSchema,
    normalizerVersion: nonEmptyStringSchema,
    sanitizerVersion: nonEmptyStringSchema,
    manifestSha256: sha256Schema,
  })
  .refine(
    (value) => value.selectedThroughSequence >= value.selectedAfterSequence,
    {
      message: "selectedThroughSequence must not precede selectedAfterSequence",
    },
  );
export type CreateLearningRunV1 = z.infer<typeof createLearningRunV1Schema>;

/** Appends one validated attempt-private learning chunk. */
export const appendLearningRunChunkV1Schema = z
  .looseObject({
    ...commandEnvelopeShape,
    learningRunId: uuidSchema,
    attemptId: uuidSchema,
    fenceGeneration: nonNegativeIntegerSchema,
    chunkIndex: nonNegativeIntegerSchema,
    chunk: learningChunkV1Schema,
  })
  .superRefine((command, context) => {
    if (
      command.learningRunId !== command.chunk.learningRunId ||
      command.attemptId !== command.chunk.attemptId ||
      command.chunkIndex !== command.chunk.chunkIndex
    ) {
      context.addIssue({
        code: "custom",
        path: ["chunk"],
        message: "Chunk identity must match its append command envelope",
      });
    }
  });
export type AppendLearningRunChunkV1 = z.infer<
  typeof appendLearningRunChunkV1Schema
>;

/** Starts an idempotent scheduled or manual run for one scoped container. */
export const startLearningContainerRunV1Schema = z.looseObject({
  ...commandEnvelopeShape,
  organizationId: idSchema,
  projectId: idSchema,
  learningContainerId: uuidSchema,
  trigger: z.enum(["nightly", "manual"]),
  idempotencyKey: nonEmptyStringSchema,
});
export type StartLearningContainerRunV1 = z.infer<
  typeof startLearningContainerRunV1Schema
>;

/** Claims and prepares one fenced attempt over the run's frozen manifest. */
export const prepareLearningRunV1Schema = z.looseObject({
  ...commandEnvelopeShape,
  learningRunId: uuidSchema,
  attemptId: uuidSchema,
  fenceGeneration: nonNegativeIntegerSchema,
  queueJobId: nonEmptyStringSchema,
});
export type PrepareLearningRunV1 = z.infer<typeof prepareLearningRunV1Schema>;

/** Commits a validated aggregate output under the active attempt fence. */
export const commitLearningRunResultV1Schema = z.looseObject({
  ...commandEnvelopeShape,
  learningRunId: uuidSchema,
  attemptId: uuidSchema,
  fenceGeneration: nonNegativeIntegerSchema,
  outputSha256: sha256Schema,
  workflowOutput: learningWorkflowOutputV1Schema,
});
export type CommitLearningRunResultV1 = z.infer<
  typeof commitLearningRunResultV1Schema
>;

/** Converts one generated output alias into an immutable candidate revision. */
export const prepareRegistryCandidateV1Schema = z
  .looseObject({
    ...commandEnvelopeShape,
    learningRunId: uuidSchema,
    outputAlias: nonEmptyStringSchema,
    idempotencyKey: nonEmptyStringSchema,
    generatedCandidate: generatedSkillCandidateV1Schema,
  })
  .refine(
    (command) => command.outputAlias === command.generatedCandidate.outputAlias,
    {
      path: ["generatedCandidate", "outputAlias"],
      message: "Generated candidate output alias must match the command alias",
    },
  );
export type PrepareRegistryCandidateV1 = z.infer<
  typeof prepareRegistryCandidateV1Schema
>;

/** Evaluates every required gate against one exact candidate subject. */
export const evaluateCandidateGatesV1Schema = z.looseObject({
  ...commandEnvelopeShape,
  candidateRevisionId: uuidSchema,
  subjectSha256: sha256Schema,
  evaluatorProfileRef: nonEmptyStringSchema,
});
export type EvaluateCandidateGatesV1 = z.infer<
  typeof evaluateCandidateGatesV1Schema
>;

/** Publishes one candidate independently under parent and archive fences. */
export const publishCandidateV1Schema = z.looseObject({
  ...commandEnvelopeShape,
  candidateRevisionId: uuidSchema,
  subjectSha256: sha256Schema,
  publicationIdempotencyKey: nonEmptyStringSchema,
  expectedParentVersionId: uuidSchema.nullable(),
  expectedArchiveFence: nonNegativeIntegerSchema,
});
export type PublishCandidateV1 = z.infer<typeof publishCandidateV1Schema>;

/** Creates one forward-only complete registry revision. */
export const createRegistryRevisionV1Schema = z.looseObject({
  ...commandEnvelopeShape,
  organizationId: idSchema,
  projectId: idSchema,
  learningContainerId: uuidSchema,
  expectedRegistryRevision: nonEmptyStringSchema,
  expectedArchiveFence: nonNegativeIntegerSchema,
  idempotencyKey: nonEmptyStringSchema,
  reasonCode: nonEmptyStringSchema,
  mutation: jsonValueSchema,
});
export type CreateRegistryRevisionV1 = z.infer<
  typeof createRegistryRevisionV1Schema
>;

/** Best-effort, non-durable request to snapshot already-finished assigned runs. */
export const requestThreadSnapshotBackfillV1Schema = z.looseObject({
  ...commandEnvelopeShape,
  organizationId: idSchema,
  projectId: idSchema,
  threadId: idSchema,
  learningContainerId: uuidSchema.nullable(),
  assignmentRevision: nonNegativeIntegerSchema,
});
export type RequestThreadSnapshotBackfillV1 = z.infer<
  typeof requestThreadSnapshotBackfillV1Schema
>;
