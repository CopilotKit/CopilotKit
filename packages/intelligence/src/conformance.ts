import {
  COPILOTKIT_CANDIDATE_SEMANTICS_META_SCHEMA_URI,
  learningContractCandidateSemanticsMetaSchema,
  toLearningContractJsonSchema,
} from "./contracts.js";
import type { JsonValue } from "./contracts.js";
import { learningContractSchemas } from "./schema-registry.js";

/** Canonical Zod schemas corresponding one-to-one with corpus schema names. */
export const learningPlatformConformanceSchemas = learningContractSchemas;

export type LearningPlatformConformanceSchemaName =
  keyof typeof learningPlatformConformanceSchemas;

export interface LearningPlatformConformanceCase {
  readonly name: string;
  readonly schema: LearningPlatformConformanceSchemaName;
  readonly valid: boolean;
  readonly value: JsonValue;
}

export interface LearningPlatformConformanceCorpus {
  readonly schemaVersion: 1;
  readonly metaSchemas: Readonly<Record<string, JsonValue>>;
  readonly schemas: Readonly<
    Record<LearningPlatformConformanceSchemaName, JsonValue>
  >;
  readonly cases: readonly LearningPlatformConformanceCase[];
}

const UUID = {
  annotation: "11111111-1111-4111-8111-111111111111",
  attempt: "22222222-2222-4222-8222-222222222222",
  candidate: "33333333-3333-4333-8333-333333333333",
  candidateRevision: "44444444-4444-4444-8444-444444444444",
  container: "55555555-5555-4555-8555-555555555555",
  gate: "66666666-6666-4666-8666-666666666666",
  insight: "77777777-7777-4777-8777-777777777777",
  run: "88888888-8888-4888-8888-888888888888",
  skill: "99999999-9999-4999-8999-999999999999",
  snapshot: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  version: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
} as const;
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const NOW = "2026-07-16T18:00:00.000Z";

const toolCall = { id: "call_1", name: "search", argsText: "{}" };
const toolResult = {
  toolCallId: "call_1",
  status: "ok",
  output: { hits: 1 },
};
const assistantCallMessage = {
  messageId: "message_1",
  role: "assistant",
  content: "searching",
  toolCalls: [toolCall],
  toolResults: [],
  eventIds: ["event_1"],
  timestamp: NOW,
};
const toolResultMessage = {
  messageId: "message_2",
  role: "tool",
  content: "done",
  toolCalls: [],
  toolResults: [toolResult],
  eventIds: ["event_1"],
  timestamp: NOW,
};
const activityMessage = {
  messageId: "message_3",
  role: "activity",
  activityType: "handoff",
  activityMetadata: { destination: "support" },
  content: null,
  toolCalls: [],
  toolResults: [],
  eventIds: ["event_1"],
  timestamp: NOW,
};
const sourceEvent = {
  eventId: "event_1",
  sequence: 1,
  type: "TEXT_MESSAGE_END",
  sha256: SHA_A,
};
const terminalSourceEvent = { ...sourceEvent, type: "RUN_ERROR" };
const attachment = {
  schemaVersion: 1,
  provider: "s3",
  objectLocator: {
    resource: "learning-evidence",
    key: "snapshots/attachment.txt",
    version: null,
  },
  name: "attachment.txt",
  mediaType: "text/plain",
  byteLength: 12,
  checksum: { algorithm: "sha256", value: SHA_A },
  metadata: { source: "gateway" },
};
const terminalError = {
  schemaVersion: 1,
  message: "The run failed.",
  code: "MODEL_FAILED",
  category: "model",
  details: { attempt: 1 },
  stack: null,
};
const retainedEvidenceEvent = {
  eventId: "event_custom",
  type: "CUSTOM",
  timestamp: NOW,
  payload: { answer: 42 },
};
const retainedEvidence = {
  schemaVersion: 1,
  events: [retainedEvidenceEvent],
};
const evidenceLocator = {
  messageIds: ["message_1"],
  eventIds: ["event_1"],
};
const evidenceRef = {
  evidenceType: "run_snapshot",
  snapshotId: UUID.snapshot,
  snapshotSha256: SHA_A,
  annotationId: null,
  annotationSha256: null,
  threadId: "thread_1",
  externalRunId: "external_run_1",
  messageIds: ["message_1"],
  eventIds: ["event_1"],
  excerpt: null,
  excerptSha256: null,
  truncated: false,
};
const selectedAnnotation = {
  schemaVersion: 1,
  annotationId: UUID.annotation,
  targetSnapshotId: UUID.snapshot,
  targetEvidenceLocator: evidenceLocator,
  text: "Prefer idempotent retries.",
  contentSha256: SHA_B,
  annotationRevision: 0,
  authoredAt: NOW,
  capturedAt: NOW,
};
const blobLocator = {
  schemaVersion: 1,
  backendId: "primary",
  provider: "awsS3",
  resource: "skill-bundles",
  key: "objects/aa/bundle.zip",
  providerVersion: null,
  etag: null,
  applicationSha256: SHA_A,
  providerChecksum: null,
  byteLength: 12,
  contentType: "application/zip",
};
const artifactFile = {
  path: "SKILL.md",
  role: "instructions",
  mediaType: "text/markdown",
  byteLength: 12,
  rawSha256: SHA_A,
};
const artifactManifest = {
  manifestVersion: 1,
  agentSkillsProfile: "agentskills:v1",
  files: [artifactFile],
  manifestSha256: SHA_A,
  bundleSha256: SHA_A,
  bundleByteLength: 12,
  provenance: {},
};
const skillBundle = {
  schemaVersion: 1,
  manifest: artifactManifest,
  locator: blobLocator,
};
const projectionEntry = {
  skillId: UUID.skill,
  versionId: UUID.version,
  position: 0,
  name: "Idempotent retries",
  description: null,
  bundleLocator: blobLocator,
  bundleSha256: SHA_A,
  manifestSha256: SHA_A,
  bundleByteLength: 12,
  manifest: artifactManifest,
  approvalMethod: "manual",
} as const;
const { manifest: _projectionManifest, ...projectionEntryWithoutManifest } =
  projectionEntry;
const secondProjectionEntry = {
  ...projectionEntry,
  skillId: UUID.snapshot,
  versionId: UUID.attempt,
  position: 1,
} as const;
const projection = {
  schemaVersion: 1,
  learningContainerId: UUID.container,
  registryRevision: "revision_1",
  skillSetHash: SHA_A,
  etag: "registry-1",
  entries: [],
  publishedAt: NOW,
  revoked: false,
};
const snapshotIdentity = {
  snapshotId: UUID.snapshot,
  contentSha256: SHA_A,
  containerSequence: 1,
};
const learningChunk = {
  learningRunId: UUID.run,
  attemptId: UUID.attempt,
  chunkIndex: 0,
  snapshotRange: {
    firstSnapshotId: UUID.snapshot,
    lastSnapshotId: UUID.snapshot,
    firstSequence: 1,
    lastSequence: 1,
  },
  inputSha256: SHA_A,
  outputSha256: null,
  status: "planned",
  privatePayloadRef: {},
  createdAt: NOW,
  updatedAt: NOW,
};
const secondLearningChunk = {
  ...learningChunk,
  chunkIndex: 1,
  snapshotRange: {
    firstSnapshotId: UUID.annotation,
    lastSnapshotId: UUID.annotation,
    firstSequence: 2,
    lastSequence: 2,
  },
};
const workflowThread = {
  snapshotId: UUID.snapshot,
  snapshotSha256: SHA_A,
  threadId: "thread_1",
  externalRunId: "external_run_1",
  messages: [assistantCallMessage, toolResultMessage, activityMessage],
  terminalError,
  attachments: [attachment],
};
const generatedInsight = {
  outputAlias: "insight_1",
  kind: "agent_behavior",
  statement: "The agent retries completed work.",
  impact: "A repeated action can affect a user twice.",
  confidence: 0.9,
  skillEligible: true,
  evidenceRefs: [evidenceRef],
};
const generatedCandidate = {
  outputAlias: "candidate_1",
  action: "add",
  skillId: null,
  parentVersionId: null,
  bundle: {
    rootDirectoryName: "idempotent-retries",
    files: [{ path: "SKILL.md", contentBase64: "IyBTa2lsbA==" }],
  },
  removalIntent: null,
  insightAliases: ["insight_1"],
  evidenceRefs: [evidenceRef],
  reason: "Avoid duplicate actions.",
  risk: "low",
};
const workflowOutput = {
  schemaVersion: 1,
  insights: [generatedInsight],
  skillCandidates: [generatedCandidate],
  coverage: {},
  rejections: [],
  usage: {},
};
const removeCandidate = {
  candidateId: UUID.candidate,
  candidateRevisionId: UUID.candidateRevision,
  organizationId: "org_1",
  projectId: "project_1",
  learningContainerId: UUID.container,
  learningRunId: UUID.run,
  action: "remove",
  skillId: UUID.skill,
  proposedVersionId: null,
  parentVersionId: UUID.version,
  bundleLocator: null,
  bundleSha256: null,
  removalIntent: { reasonCode: "unsafe_behavior" },
  removalIntentSha256: SHA_B,
  subjectSha256: SHA_B,
  insightIds: [UUID.insight],
  evidenceRefs: [evidenceRef],
  reason: "Remove unsafe behavior.",
  risk: "high",
  approvalModeSnapshot: "manual",
  evaluatorProfileRef: "evaluator:v1",
  status: "pending_review",
  createdByType: "learning",
  createdAt: NOW,
};
const addCandidate = {
  ...removeCandidate,
  action: "add",
  proposedVersionId: UUID.version,
  parentVersionId: null,
  bundleLocator: blobLocator,
  bundleSha256: SHA_A,
  removalIntent: null,
  removalIntentSha256: null,
  subjectSha256: SHA_A,
  reason: "Teach idempotent retries.",
  risk: "low",
};
const updateCandidate = {
  ...addCandidate,
  action: "update",
  parentVersionId: UUID.version,
};
const commandEnvelope = {
  schemaVersion: 1,
  requestId: "request_1",
  traceId: "trace_1",
};

const canonicalValidValues: Record<
  LearningPlatformConformanceSchemaName,
  JsonValue
> = {
  AppendLearningRunChunkV1: {
    ...commandEnvelope,
    learningRunId: UUID.run,
    attemptId: UUID.attempt,
    fenceGeneration: 1,
    chunkIndex: 0,
    chunk: learningChunk,
  },
  AttachmentReferenceV1: attachment,
  BlobLocatorV1: blobLocator,
  CandidateGateResultV1: {
    gateResultId: UUID.gate,
    candidateRevisionId: UUID.candidateRevision,
    subjectSha256: SHA_B,
    gate: "artifact",
    profileVersion: "artifact:v1",
    fixtureVersion: null,
    baselineVersion: null,
    status: "passed",
    reasonCode: "valid",
    detailsRef: null,
    evaluatedAt: NOW,
  },
  CommitLearningRunResultV1: {
    ...commandEnvelope,
    learningRunId: UUID.run,
    attemptId: UUID.attempt,
    fenceGeneration: 1,
    outputSha256: SHA_A,
    workflowOutput,
  },
  CreateLearningRunV1: {
    ...commandEnvelope,
    learningRunId: UUID.run,
    organizationId: "org_1",
    projectId: "project_1",
    learningContainerId: UUID.container,
    trigger: "manual",
    idempotencyKey: "run_1",
    selectedAfterSequence: 0,
    selectedThroughSequence: 1,
    snapshotIdsAndHashes: [snapshotIdentity],
    selectedAnnotations: [selectedAnnotation],
    registryRevision: "revision_1",
    skillSetHash: SHA_A,
    containerConfigRevision: 1,
    modelProfileRef: "model:v1",
    promptProfileRef: "prompt:v1",
    evaluatorProfileRef: "evaluator:v1",
    workflowVersion: "workflow:v1",
    normalizerVersion: "normalizer:v1",
    sanitizerVersion: "sanitizer:v1",
    manifestSha256: SHA_B,
  },
  CreateRegistryRevisionV1: {
    ...commandEnvelope,
    organizationId: "org_1",
    projectId: "project_1",
    learningContainerId: UUID.container,
    expectedRegistryRevision: "revision_1",
    expectedArchiveFence: 0,
    idempotencyKey: "registry_1",
    reasonCode: "candidate_published",
    mutation: {},
  },
  EvaluateCandidateGatesV1: {
    ...commandEnvelope,
    candidateRevisionId: UUID.candidateRevision,
    subjectSha256: SHA_B,
    evaluatorProfileRef: "evaluator:v1",
  },
  EvidenceLocatorV1: evidenceLocator,
  EvidenceRefV1: evidenceRef,
  FrozenAvailableSkillV1: {
    skillId: UUID.skill,
    versionId: UUID.version,
    alias: "idempotent-retries",
    name: "Idempotent retries",
    description: null,
    bundle: skillBundle,
    registryState: "published",
  },
  GeneratedInsightV1: generatedInsight,
  GeneratedSkillCandidateV1: generatedCandidate,
  InsightAnnotationV1: {
    schemaVersion: 1,
    id: UUID.annotation,
    insightId: UUID.insight,
    evidenceTarget: null,
    actor: "user_1",
    text: "Confirmed.",
    revision: 1,
    createdAt: NOW,
  },
  InsightArchiveEventV1: {
    schemaVersion: 1,
    id: UUID.annotation,
    insightId: UUID.insight,
    archived: true,
    actor: "user_1",
    createdAt: NOW,
  },
  InsightFeedbackV1: {
    schemaVersion: 1,
    id: UUID.annotation,
    insightId: UUID.insight,
    actor: "user_1",
    rating: "useful",
    note: null,
    createdAt: NOW,
  },
  InsightV1: {
    schemaVersion: 1,
    id: UUID.insight,
    organizationId: "org_1",
    projectId: "project_1",
    learningContainerId: UUID.container,
    learningRunId: UUID.run,
    workflowOutputAlias: "insight_1",
    kind: "agent_behavior",
    statement: "The agent retries completed work.",
    impact: "A repeated action can affect a user twice.",
    confidence: 0.9,
    skillEligible: true,
    evidenceRefs: [evidenceRef],
    createdAt: NOW,
  },
  LearningChunkV1: learningChunk,
  LearningContainerV1: {
    schemaVersion: 1,
    id: UUID.container,
    organizationId: "org_1",
    projectId: "project_1",
    name: "Support agent",
    description: null,
    learningEnabled: true,
    autoApproveSkillChanges: false,
    modelProfileRef: "model:v1",
    promptProfileRef: "prompt:v1",
    evaluatorProfileRef: "evaluator:v1",
    watermarkSequence: 0,
    configRevision: 1,
    archiveFence: 0,
    archivedAt: null,
    consumptionRevokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  LearningPlatformErrorResponseV1: {
    error: {
      code: "LEARNING_CONTAINER_ASSIGNMENT_MISMATCH",
      message: "Assignment does not match.",
      category: "conflict",
      retryable: false,
    },
    requestId: "request_1",
    traceId: "trace_1",
  },
  LearningRunV1: {
    learningRunId: UUID.run,
    organizationId: "org_1",
    projectId: "project_1",
    learningContainerId: UUID.container,
    trigger: "manual",
    idempotencyKey: "run_1",
    selectedAfterSequence: 0,
    selectedThroughSequence: 1,
    snapshotIdsAndHashes: [snapshotIdentity],
    selectedAnnotations: [selectedAnnotation],
    registryRevision: "revision_1",
    skillSetHash: SHA_A,
    containerConfigRevision: 1,
    modelProfileRef: "model:v1",
    promptProfileRef: "prompt:v1",
    evaluatorProfileRef: "evaluator:v1",
    workflowVersion: "workflow:v1",
    normalizerVersion: "normalizer:v1",
    sanitizerVersion: "sanitizer:v1",
    manifestSha256: SHA_B,
    status: "created",
    createdAt: NOW,
    startedAt: null,
    completedAt: null,
  },
  LearningRunExecutionResultV1: {
    outputSha256: SHA_A,
    chunks: [learningChunk],
    workflowOutput,
  },
  LearningRunJobV1: {
    ...commandEnvelope,
    learningRunId: UUID.run,
    attemptId: UUID.attempt,
    fenceGeneration: 1,
  },
  LearningWorkflowInputV1: {
    schemaVersion: 1,
    threads: [workflowThread],
    selectedAnnotations: [selectedAnnotation],
    availableSkills: [],
    promptContext: null,
    limits: {},
  },
  LearningWorkflowOutputV1: workflowOutput,
  NormalizedMessageV1: assistantCallMessage,
  NormalizedToolCallV1: toolCall,
  NormalizedToolResultV1: toolResult,
  PrepareLearningRunV1: {
    ...commandEnvelope,
    learningRunId: UUID.run,
    attemptId: UUID.attempt,
    fenceGeneration: 1,
    queueJobId: "job_1",
  },
  PrepareRegistryCandidateV1: {
    ...commandEnvelope,
    learningRunId: UUID.run,
    outputAlias: "candidate_1",
    idempotencyKey: "candidate_1",
    generatedCandidate,
  },
  PublishCandidateV1: {
    ...commandEnvelope,
    candidateRevisionId: UUID.candidateRevision,
    subjectSha256: SHA_B,
    publicationIdempotencyKey: "publish_1",
    expectedParentVersionId: UUID.version,
    expectedArchiveFence: 0,
  },
  RequestThreadSnapshotBackfillV1: {
    ...commandEnvelope,
    organizationId: "org_1",
    projectId: "project_1",
    threadId: "thread_1",
    learningContainerId: null,
    assignmentRevision: 0,
  },
  RunSnapshotV1: {
    schemaVersion: 1,
    snapshotId: UUID.snapshot,
    organizationId: "org_1",
    projectId: "project_1",
    learningContainerId: UUID.container,
    threadId: "thread_1",
    agentRunId: "agent_run_1",
    externalRunId: "external_run_1",
    terminalEventId: "event_1",
    terminalType: "RUN_ERROR",
    terminalStatus: null,
    terminalError,
    startedAt: NOW,
    terminalAt: NOW,
    capturedAt: NOW,
    assignmentRevision: 0,
    sourceEvents: [terminalSourceEvent],
    messages: [assistantCallMessage, toolResultMessage, activityMessage],
    retainedEvidence,
    stateChanges: [],
    annotations: [],
    attachments: [attachment],
    normalizerVersion: "normalizer:v1",
    sanitizerVersion: "sanitizer:v1",
    contentSha256: SHA_A,
    byteLength: 100,
    tokenEstimate: 25,
    containerSequence: 1,
  },
  SelectedHumanAnnotationV1: selectedAnnotation,
  SkillArtifactFileV1: artifactFile,
  SkillArtifactManifestV1: artifactManifest,
  SkillBundleV1: skillBundle,
  SkillCandidateV1: removeCandidate,
  SkillSetProjectionEntryV1: projectionEntry,
  SkillSetProjectionV1: projection,
  SnapshotIdentityV1: snapshotIdentity,
  SourceEventManifestEntryV1: sourceEvent,
  StartLearningContainerRunV1: {
    ...commandEnvelope,
    organizationId: "org_1",
    projectId: "project_1",
    learningContainerId: UUID.container,
    trigger: "manual",
    idempotencyKey: "run_1",
  },
  TerminalErrorV1: terminalError,
  ThreadAssignmentPatchV1: {
    learningContainerId: null,
    expectedLearningContainerId: null,
  },
  ThreadAssignmentV1: {
    learningContainerId: null,
    assignmentRevision: 0,
  },
  WorkflowThreadV1: workflowThread,
};

const commandSchemaNames = [
  "AppendLearningRunChunkV1",
  "CommitLearningRunResultV1",
  "CreateLearningRunV1",
  "CreateRegistryRevisionV1",
  "EvaluateCandidateGatesV1",
  "PrepareLearningRunV1",
  "PrepareRegistryCandidateV1",
  "PublishCandidateV1",
  "RequestThreadSnapshotBackfillV1",
  "StartLearningContainerRunV1",
] as const;

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]),
    );
  }
  return value;
}

function withoutJsonProperty(
  value: Readonly<Record<string, JsonValue>>,
  property: string,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== property),
  );
}

function nestedJsonValue(objectDepth: number): JsonValue {
  let value: JsonValue = "leaf";
  for (let depth = 1; depth < objectDepth; depth += 1) {
    value = { nested: value };
  }
  return value;
}

function jsonObjectWithSerializedUtf8Bytes(
  targetBytes: number,
  maximumStringBytes = 2_048,
): JsonValue {
  let entryCount = 1;
  let entries = Array.from({ length: entryCount }, (_, index) => [
    `k${index}`,
    "",
  ]);
  while (
    targetBytes - JSON.stringify(Object.fromEntries(entries)).length >
    entryCount * maximumStringBytes
  ) {
    entryCount += 1;
    entries = Array.from({ length: entryCount }, (_, index) => [
      `k${index}`,
      "",
    ]);
  }
  const emptySerializedBytes = JSON.stringify(
    Object.fromEntries(entries),
  ).length;
  let remaining = targetBytes - emptySerializedBytes;
  for (const entry of entries) {
    const length = Math.min(maximumStringBytes, remaining);
    entry[1] = "a".repeat(length);
    remaining -= length;
  }
  if (remaining !== 0) {
    throw new Error(`Unable to build ${targetBytes}-byte bounded JSON fixture`);
  }
  return Object.fromEntries(entries);
}

function buildCases(): LearningPlatformConformanceCase[] {
  const cases: LearningPlatformConformanceCase[] = [];
  const schemaNames = Object.keys(
    learningPlatformConformanceSchemas,
  ).sort() as LearningPlatformConformanceSchemaName[];

  for (const schema of schemaNames) {
    cases.push({
      name: `schema-${schema}-valid`,
      schema,
      valid: true,
      value: canonicalValidValues[schema],
    });
    cases.push({
      name: `schema-${schema}-rejects-null`,
      schema,
      valid: false,
      value: null,
    });
  }

  for (const schema of commandSchemaNames) {
    cases.push({
      name: `command-${schema}-valid`,
      schema,
      valid: true,
      value: canonicalValidValues[schema],
    });
  }

  const canonicalAttachment = canonicalValidValues.AttachmentReferenceV1 as
    | Record<string, JsonValue>
    | undefined;
  const canonicalTerminalError = canonicalValidValues.TerminalErrorV1 as
    | Record<string, JsonValue>
    | undefined;
  const canonicalSnapshot = canonicalValidValues.RunSnapshotV1 as
    | Record<string, JsonValue>
    | undefined;
  const canonicalMessage = canonicalValidValues.NormalizedMessageV1 as
    | Record<string, JsonValue>
    | undefined;
  const canonicalWorkflowThread = canonicalValidValues.WorkflowThreadV1 as
    | Record<string, JsonValue>
    | undefined;
  if (
    canonicalAttachment === undefined ||
    canonicalTerminalError === undefined ||
    canonicalSnapshot === undefined ||
    canonicalMessage === undefined ||
    canonicalWorkflowThread === undefined
  ) {
    throw new Error("Canonical evidence fixtures are missing");
  }

  for (const nullableField of [
    "name",
    "mediaType",
    "byteLength",
    "checksum",
    "metadata",
  ]) {
    cases.push({
      name: `attachment-requires-nullable-${nullableField}`,
      schema: "AttachmentReferenceV1",
      valid: false,
      value: withoutJsonProperty(canonicalAttachment, nullableField),
    });
  }
  for (const nullableField of ["code", "category", "details", "stack"]) {
    cases.push({
      name: `terminal-error-requires-nullable-${nullableField}`,
      schema: "TerminalErrorV1",
      valid: false,
      value: withoutJsonProperty(canonicalTerminalError, nullableField),
    });
  }

  cases.push(
    {
      name: "attachment-provider-accepts-exact-utf8-boundary",
      schema: "AttachmentReferenceV1",
      valid: true,
      value: { ...canonicalAttachment, provider: "é".repeat(32) },
    },
    {
      name: "attachment-provider-rejects-utf8-boundary-plus-one",
      schema: "AttachmentReferenceV1",
      valid: false,
      value: { ...canonicalAttachment, provider: "é".repeat(33) },
    },
    {
      name: "attachment-rejects-unknown-reference-field",
      schema: "AttachmentReferenceV1",
      valid: false,
      value: { ...canonicalAttachment, rawAttachment: { secret: true } },
    },
    {
      name: "attachment-rejects-unknown-locator-field",
      schema: "AttachmentReferenceV1",
      valid: false,
      value: {
        ...canonicalAttachment,
        objectLocator: {
          ...(canonicalAttachment.objectLocator as Record<string, JsonValue>),
          body: "inline",
        },
      },
    },
    {
      name: "attachment-rejects-unknown-checksum-field",
      schema: "AttachmentReferenceV1",
      valid: false,
      value: {
        ...canonicalAttachment,
        checksum: {
          ...(canonicalAttachment.checksum as Record<string, JsonValue>),
          encoding: "hex",
        },
      },
    },
    {
      name: "attachment-metadata-accepts-exact-serialized-boundary",
      schema: "AttachmentReferenceV1",
      valid: true,
      value: {
        ...canonicalAttachment,
        metadata: jsonObjectWithSerializedUtf8Bytes(16_384),
      },
    },
    {
      name: "attachment-metadata-rejects-serialized-boundary-plus-one",
      schema: "AttachmentReferenceV1",
      valid: false,
      value: {
        ...canonicalAttachment,
        metadata: jsonObjectWithSerializedUtf8Bytes(16_385),
      },
    },
    {
      name: "attachment-metadata-rejects-recursive-inline-payload",
      schema: "AttachmentReferenceV1",
      valid: false,
      value: {
        ...canonicalAttachment,
        metadata: { nested: { dataBase64: "aGVsbG8=" } },
      },
    },
    {
      name: "attachment-metadata-rejects-depth-boundary-plus-one",
      schema: "AttachmentReferenceV1",
      valid: false,
      value: { ...canonicalAttachment, metadata: nestedJsonValue(7) },
    },
    {
      name: "attachment-metadata-rejects-node-boundary-plus-one",
      schema: "AttachmentReferenceV1",
      valid: false,
      value: {
        ...canonicalAttachment,
        metadata: { values: Array.from({ length: 127 }, () => null) },
      },
    },
    {
      name: "attachment-metadata-rejects-property-boundary-plus-one",
      schema: "AttachmentReferenceV1",
      valid: false,
      value: {
        ...canonicalAttachment,
        metadata: Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [`key${index}`, index]),
        ),
      },
    },
    {
      name: "attachment-metadata-rejects-array-boundary-plus-one",
      schema: "AttachmentReferenceV1",
      valid: false,
      value: {
        ...canonicalAttachment,
        metadata: { values: Array.from({ length: 33 }, () => null) },
      },
    },
    {
      name: "attachment-metadata-rejects-string-boundary-plus-one",
      schema: "AttachmentReferenceV1",
      valid: false,
      value: {
        ...canonicalAttachment,
        metadata: { value: "é".repeat(1_025) },
      },
    },
    {
      name: "attachment-metadata-rejects-key-boundary-plus-one",
      schema: "AttachmentReferenceV1",
      valid: false,
      value: { ...canonicalAttachment, metadata: { ["k".repeat(129)]: true } },
    },
    {
      name: "terminal-error-message-accepts-exact-utf8-boundary",
      schema: "TerminalErrorV1",
      valid: true,
      value: { ...canonicalTerminalError, message: "é".repeat(2_048) },
    },
    {
      name: "terminal-error-message-rejects-utf8-boundary-plus-one",
      schema: "TerminalErrorV1",
      valid: false,
      value: { ...canonicalTerminalError, message: "é".repeat(2_049) },
    },
    {
      name: "terminal-error-rejects-unknown-field",
      schema: "TerminalErrorV1",
      valid: false,
      value: { ...canonicalTerminalError, rawError: "must not cross" },
    },
    {
      name: "terminal-error-details-rejects-array-boundary-plus-one",
      schema: "TerminalErrorV1",
      valid: false,
      value: {
        ...canonicalTerminalError,
        details: { values: Array.from({ length: 65 }, () => null) },
      },
    },
    {
      name: "terminal-error-details-accepts-exact-serialized-boundary",
      schema: "TerminalErrorV1",
      valid: true,
      value: {
        ...canonicalTerminalError,
        details: jsonObjectWithSerializedUtf8Bytes(32_768, 4_096),
      },
    },
    {
      name: "terminal-error-details-rejects-serialized-boundary-plus-one",
      schema: "TerminalErrorV1",
      valid: false,
      value: {
        ...canonicalTerminalError,
        details: jsonObjectWithSerializedUtf8Bytes(32_769, 4_096),
      },
    },
    {
      name: "terminal-error-details-rejects-depth-boundary-plus-one",
      schema: "TerminalErrorV1",
      valid: false,
      value: { ...canonicalTerminalError, details: nestedJsonValue(9) },
    },
    {
      name: "terminal-error-details-rejects-node-boundary-plus-one",
      schema: "TerminalErrorV1",
      valid: false,
      value: {
        ...canonicalTerminalError,
        details: { values: Array.from({ length: 255 }, () => null) },
      },
    },
    {
      name: "terminal-error-details-rejects-property-boundary-plus-one",
      schema: "TerminalErrorV1",
      valid: false,
      value: {
        ...canonicalTerminalError,
        details: Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [`key${index}`, index]),
        ),
      },
    },
    {
      name: "terminal-error-details-rejects-string-boundary-plus-one",
      schema: "TerminalErrorV1",
      valid: false,
      value: {
        ...canonicalTerminalError,
        details: { value: "é".repeat(2_049) },
      },
    },
    {
      name: "terminal-error-details-rejects-key-boundary-plus-one",
      schema: "TerminalErrorV1",
      valid: false,
      value: {
        ...canonicalTerminalError,
        details: { ["k".repeat(257)]: true },
      },
    },
    {
      name: "terminal-error-code-rejects-utf8-boundary-plus-one",
      schema: "TerminalErrorV1",
      valid: false,
      value: { ...canonicalTerminalError, code: "é".repeat(129) },
    },
    {
      name: "terminal-error-category-rejects-utf8-boundary-plus-one",
      schema: "TerminalErrorV1",
      valid: false,
      value: { ...canonicalTerminalError, category: "é".repeat(129) },
    },
    {
      name: "terminal-error-stack-rejects-utf8-boundary-plus-one",
      schema: "TerminalErrorV1",
      valid: false,
      value: { ...canonicalTerminalError, stack: "é".repeat(8_193) },
    },
    {
      name: "normalized-activity-requires-activity-type",
      schema: "NormalizedMessageV1",
      valid: false,
      value: {
        ...withoutJsonProperty(canonicalMessage, "activityType"),
        role: "activity",
      },
    },
    {
      name: "normalized-tool-message-requires-result",
      schema: "NormalizedMessageV1",
      valid: false,
      value: { ...canonicalMessage, role: "tool", toolResults: [] },
    },
    {
      name: "run-snapshot-rejects-unknown-tool-result-reference",
      schema: "RunSnapshotV1",
      valid: false,
      value: {
        ...canonicalSnapshot,
        messages: [
          {
            ...canonicalMessage,
            toolResults: [{ ...toolResult, toolCallId: "missing" }],
          },
        ],
      },
    },
    {
      name: "run-error-requires-terminal-error",
      schema: "RunSnapshotV1",
      valid: false,
      value: {
        ...canonicalSnapshot,
        terminalType: "RUN_ERROR",
        terminalError: null,
        sourceEvents: [{ ...terminalSourceEvent, type: "RUN_ERROR" }],
      },
    },
    {
      name: "run-finished-forbids-terminal-error",
      schema: "RunSnapshotV1",
      valid: false,
      value: {
        ...canonicalSnapshot,
        terminalType: "RUN_FINISHED",
        sourceEvents: [{ ...terminalSourceEvent, type: "RUN_FINISHED" }],
      },
    },
    {
      name: "run-snapshot-accepts-omitted-retained-evidence",
      schema: "RunSnapshotV1",
      valid: true,
      value: withoutJsonProperty(canonicalSnapshot, "retainedEvidence"),
    },
    {
      name: "run-snapshot-rejects-untyped-attachment-payload",
      schema: "RunSnapshotV1",
      valid: false,
      value: { ...canonicalSnapshot, attachments: [{ body: "inline" }] },
    },
    {
      name: "run-snapshot-rejects-attachment-entry-boundary-plus-one",
      schema: "RunSnapshotV1",
      valid: false,
      value: {
        ...canonicalSnapshot,
        attachments: Array.from({ length: 33 }, () => attachment),
      },
    },
    {
      name: "run-snapshot-rejects-untyped-retained-evidence-event",
      schema: "RunSnapshotV1",
      valid: false,
      value: {
        ...canonicalSnapshot,
        retainedEvidence: { schemaVersion: 1, events: [{ nope: true }] },
      },
    },
    {
      name: "workflow-thread-requires-terminal-error-projection",
      schema: "WorkflowThreadV1",
      valid: false,
      value: withoutJsonProperty(canonicalWorkflowThread, "terminalError"),
    },
    {
      name: "workflow-thread-requires-attachment-projection",
      schema: "WorkflowThreadV1",
      valid: false,
      value: withoutJsonProperty(canonicalWorkflowThread, "attachments"),
    },
  );

  cases.push(
    {
      name: "thread-assignment-null-is-explicit",
      schema: "ThreadAssignmentPatchV1",
      valid: true,
      value: canonicalValidValues.ThreadAssignmentPatchV1,
    },
    {
      name: "thread-assignment-missing-is-not-defaulted",
      schema: "ThreadAssignmentPatchV1",
      valid: false,
      value: { learningContainerId: null },
    },
    {
      name: "unknown-fields-are-forward-compatible",
      schema: "LearningContainerV1",
      valid: true,
      value: {
        ...(canonicalValidValues.LearningContainerV1 as Record<
          string,
          JsonValue
        >),
        futureField: { enabled: true },
      },
    },
    {
      name: "invalid-uuid",
      schema: "ThreadAssignmentPatchV1",
      valid: false,
      value: {
        learningContainerId: "not-a-uuid",
        expectedLearningContainerId: null,
      },
    },
    {
      name: "invalid-nil-uuid",
      schema: "ThreadAssignmentPatchV1",
      valid: false,
      value: {
        learningContainerId: "00000000-0000-0000-0000-000000000000",
        expectedLearningContainerId: null,
      },
    },
    {
      name: "invalid-sha256",
      schema: "BlobLocatorV1",
      valid: false,
      value: {
        ...(canonicalValidValues.BlobLocatorV1 as Record<string, JsonValue>),
        applicationSha256: "ABC123",
      },
    },
    {
      name: "invalid-assignment-revision",
      schema: "ThreadAssignmentV1",
      valid: false,
      value: { learningContainerId: null, assignmentRevision: -1 },
    },
    {
      name: "learning-run-rejects-inverted-selection-interval",
      schema: "LearningRunV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningRunV1 as Record<string, JsonValue>),
        selectedAfterSequence: 2,
        selectedThroughSequence: 1,
        snapshotIdsAndHashes: [],
      },
    },
    {
      name: "learning-run-rejects-snapshot-outside-selection-interval",
      schema: "LearningRunV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningRunV1 as Record<string, JsonValue>),
        selectedAfterSequence: 1,
        selectedThroughSequence: 2,
        snapshotIdsAndHashes: [snapshotIdentity],
      },
    },
    {
      name: "learning-run-rejects-duplicate-snapshot-identities",
      schema: "LearningRunV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningRunV1 as Record<string, JsonValue>),
        selectedThroughSequence: 2,
        snapshotIdsAndHashes: [
          snapshotIdentity,
          { ...snapshotIdentity, contentSha256: SHA_B, containerSequence: 2 },
        ],
      },
    },
    {
      name: "learning-run-rejects-case-variant-snapshot-identities",
      schema: "LearningRunV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningRunV1 as Record<string, JsonValue>),
        selectedThroughSequence: 2,
        snapshotIdsAndHashes: [
          snapshotIdentity,
          {
            ...snapshotIdentity,
            snapshotId: UUID.snapshot.toUpperCase(),
            contentSha256: SHA_B,
            containerSequence: 2,
          },
        ],
      },
    },
    {
      name: "learning-run-rejects-annotation-outside-frozen-snapshots",
      schema: "LearningRunV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningRunV1 as Record<string, JsonValue>),
        selectedAnnotations: [
          { ...selectedAnnotation, targetSnapshotId: UUID.container },
        ],
      },
    },
    {
      name: "learning-run-resolves-annotation-snapshot-case-insensitively",
      schema: "LearningRunV1",
      valid: true,
      value: {
        ...(canonicalValidValues.LearningRunV1 as Record<string, JsonValue>),
        selectedAnnotations: [
          {
            ...selectedAnnotation,
            targetSnapshotId: UUID.snapshot.toUpperCase(),
          },
        ],
      },
    },
    {
      name: "learning-run-rejects-unordered-snapshot-identities",
      schema: "LearningRunV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningRunV1 as Record<string, JsonValue>),
        selectedThroughSequence: 2,
        snapshotIdsAndHashes: [
          {
            snapshotId: UUID.annotation,
            contentSha256: SHA_B,
            containerSequence: 2,
          },
          snapshotIdentity,
        ],
      },
    },
    {
      name: "learning-chunk-rejects-inverted-snapshot-range",
      schema: "LearningChunkV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningChunkV1 as Record<string, JsonValue>),
        snapshotRange: {
          firstSnapshotId: UUID.snapshot,
          lastSnapshotId: UUID.snapshot,
          firstSequence: 2,
          lastSequence: 1,
        },
      },
    },
    {
      name: "workflow-input-rejects-duplicate-thread-ids",
      schema: "LearningWorkflowInputV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningWorkflowInputV1 as Record<
          string,
          JsonValue
        >),
        threads: [
          workflowThread,
          {
            ...workflowThread,
            snapshotId: UUID.annotation,
            snapshotSha256: SHA_B,
            externalRunId: "external_run_2",
          },
        ],
      },
    },
    {
      name: "workflow-input-rejects-duplicate-snapshot-ids",
      schema: "LearningWorkflowInputV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningWorkflowInputV1 as Record<
          string,
          JsonValue
        >),
        threads: [
          workflowThread,
          {
            ...workflowThread,
            threadId: "thread_2",
            externalRunId: "external_run_2",
          },
        ],
      },
    },
    {
      name: "workflow-input-rejects-case-variant-snapshot-ids",
      schema: "LearningWorkflowInputV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningWorkflowInputV1 as Record<
          string,
          JsonValue
        >),
        threads: [
          workflowThread,
          {
            ...workflowThread,
            snapshotId: UUID.snapshot.toUpperCase(),
            threadId: "thread_2",
            externalRunId: "external_run_2",
          },
        ],
      },
    },
    {
      name: "workflow-input-resolves-annotation-snapshot-case-insensitively",
      schema: "LearningWorkflowInputV1",
      valid: true,
      value: {
        ...(canonicalValidValues.LearningWorkflowInputV1 as Record<
          string,
          JsonValue
        >),
        selectedAnnotations: [
          {
            ...selectedAnnotation,
            targetSnapshotId: UUID.snapshot.toUpperCase(),
          },
        ],
      },
    },
    {
      name: "workflow-input-rejects-duplicate-skill-aliases",
      schema: "LearningWorkflowInputV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningWorkflowInputV1 as Record<
          string,
          JsonValue
        >),
        availableSkills: [
          canonicalValidValues.FrozenAvailableSkillV1,
          {
            ...(canonicalValidValues.FrozenAvailableSkillV1 as Record<
              string,
              JsonValue
            >),
            skillId: UUID.candidate,
            versionId: UUID.candidateRevision,
          },
        ],
      },
    },
    {
      name: "workflow-input-rejects-annotation-outside-frozen-input",
      schema: "LearningWorkflowInputV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningWorkflowInputV1 as Record<
          string,
          JsonValue
        >),
        selectedAnnotations: [
          { ...selectedAnnotation, targetSnapshotId: UUID.container },
        ],
      },
    },
    {
      name: "workflow-input-rejects-annotation-message-outside-target-snapshot",
      schema: "LearningWorkflowInputV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningWorkflowInputV1 as Record<
          string,
          JsonValue
        >),
        selectedAnnotations: [
          {
            ...selectedAnnotation,
            targetEvidenceLocator: {
              messageIds: ["missing_message"],
              eventIds: [],
            },
          },
        ],
      },
    },
    {
      name: "workflow-input-rejects-annotation-event-outside-target-snapshot",
      schema: "LearningWorkflowInputV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningWorkflowInputV1 as Record<
          string,
          JsonValue
        >),
        selectedAnnotations: [
          {
            ...selectedAnnotation,
            targetEvidenceLocator: {
              messageIds: [],
              eventIds: ["missing_event"],
            },
          },
        ],
      },
    },
    {
      name: "workflow-output-rejects-duplicate-insight-aliases",
      schema: "LearningWorkflowOutputV1",
      valid: false,
      value: {
        ...workflowOutput,
        insights: [generatedInsight, generatedInsight],
      },
    },
    {
      name: "workflow-output-rejects-duplicate-candidate-aliases",
      schema: "LearningWorkflowOutputV1",
      valid: false,
      value: {
        ...workflowOutput,
        skillCandidates: [generatedCandidate, generatedCandidate],
      },
    },
    {
      name: "workflow-output-rejects-dangling-insight-aliases",
      schema: "LearningWorkflowOutputV1",
      valid: false,
      value: {
        ...workflowOutput,
        skillCandidates: [
          { ...generatedCandidate, insightAliases: ["missing_insight"] },
        ],
      },
    },
    {
      name: "artifact-manifest-accepts-safe-nfc-distinct-paths",
      schema: "SkillArtifactManifestV1",
      valid: true,
      value: {
        ...artifactManifest,
        files: [
          artifactFile,
          { ...artifactFile, path: "references/1.txt" },
          { ...artifactFile, path: "references/\u2460.txt" },
        ],
      },
    },
    {
      name: "artifact-manifest-rejects-traversal-path",
      schema: "SkillArtifactManifestV1",
      valid: false,
      value: {
        ...artifactManifest,
        files: [artifactFile, { ...artifactFile, path: "../escape.txt" }],
      },
    },
    {
      name: "artifact-manifest-rejects-absolute-path",
      schema: "SkillArtifactManifestV1",
      valid: false,
      value: {
        ...artifactManifest,
        files: [artifactFile, { ...artifactFile, path: "C:/escape.txt" }],
      },
    },
    {
      name: "artifact-manifest-rejects-backslash-path",
      schema: "SkillArtifactManifestV1",
      valid: false,
      value: {
        ...artifactManifest,
        files: [
          artifactFile,
          { ...artifactFile, path: "references\\escape.txt" },
        ],
      },
    },
    {
      name: "artifact-manifest-rejects-case-path-collision",
      schema: "SkillArtifactManifestV1",
      valid: false,
      value: {
        ...artifactManifest,
        files: [
          artifactFile,
          { ...artifactFile, path: "references/Case.txt" },
          { ...artifactFile, path: "references/case.txt" },
        ],
      },
    },
    {
      name: "artifact-manifest-rejects-nfc-path-collision",
      schema: "SkillArtifactManifestV1",
      valid: false,
      value: {
        ...artifactManifest,
        files: [
          artifactFile,
          { ...artifactFile, path: "references/caf\u00e9.txt" },
          { ...artifactFile, path: "references/cafe\u0301.txt" },
        ],
      },
    },
    {
      name: "artifact-manifest-rejects-missing-skill-md",
      schema: "SkillArtifactManifestV1",
      valid: false,
      value: {
        ...artifactManifest,
        files: [{ ...artifactFile, path: "README.md" }],
      },
    },
    {
      name: "artifact-manifest-rejects-root-prefixed-skill-md",
      schema: "SkillArtifactManifestV1",
      valid: false,
      value: {
        ...artifactManifest,
        files: [{ ...artifactFile, path: "idempotent-retries/SKILL.md" }],
      },
    },
    {
      name: "skill-bundle-rejects-locator-hash-mismatch",
      schema: "SkillBundleV1",
      valid: false,
      value: {
        ...skillBundle,
        locator: { ...blobLocator, applicationSha256: SHA_B },
      },
    },
    {
      name: "skill-bundle-rejects-locator-length-mismatch",
      schema: "SkillBundleV1",
      valid: false,
      value: {
        ...skillBundle,
        locator: { ...blobLocator, byteLength: 13 },
      },
    },
    {
      name: "projection-entry-rejects-missing-manifest",
      schema: "SkillSetProjectionEntryV1",
      valid: false,
      value: projectionEntryWithoutManifest,
    },
    {
      name: "projection-entry-rejects-locator-hash-mismatch",
      schema: "SkillSetProjectionEntryV1",
      valid: false,
      value: {
        ...(canonicalValidValues.SkillSetProjectionEntryV1 as Record<
          string,
          JsonValue
        >),
        bundleLocator: { ...blobLocator, applicationSha256: SHA_B },
      },
    },
    {
      name: "projection-entry-rejects-locator-length-mismatch",
      schema: "SkillSetProjectionEntryV1",
      valid: false,
      value: {
        ...(canonicalValidValues.SkillSetProjectionEntryV1 as Record<
          string,
          JsonValue
        >),
        bundleLocator: { ...blobLocator, byteLength: 13 },
      },
    },
    {
      name: "projection-entry-rejects-manifest-bundle-hash-mismatch",
      schema: "SkillSetProjectionEntryV1",
      valid: false,
      value: {
        ...projectionEntry,
        manifest: { ...artifactManifest, bundleSha256: SHA_B },
      },
    },
    {
      name: "projection-entry-rejects-manifest-hash-mismatch",
      schema: "SkillSetProjectionEntryV1",
      valid: false,
      value: {
        ...projectionEntry,
        manifest: { ...artifactManifest, manifestSha256: SHA_B },
      },
    },
    {
      name: "projection-entry-rejects-manifest-length-mismatch",
      schema: "SkillSetProjectionEntryV1",
      valid: false,
      value: {
        ...projectionEntry,
        manifest: { ...artifactManifest, bundleByteLength: 13 },
      },
    },
    {
      name: "projection-revoked-rejects-entries",
      schema: "SkillSetProjectionV1",
      valid: false,
      value: {
        ...projection,
        entries: [projectionEntry],
        revoked: true,
      },
    },
    {
      name: "projection-rejects-position-above-cache-bound",
      schema: "SkillSetProjectionV1",
      valid: false,
      value: {
        ...projection,
        entries: [{ ...projectionEntry, position: 1_000_000 }],
      },
    },
    {
      name: "projection-rejects-unsafe-integer-position",
      schema: "SkillSetProjectionV1",
      valid: false,
      value: {
        ...projection,
        entries: [
          { ...projectionEntry, position: Number.MAX_SAFE_INTEGER + 1 },
        ],
      },
    },
    {
      name: "projection-rejects-duplicate-positions",
      schema: "SkillSetProjectionV1",
      valid: false,
      value: {
        ...projection,
        entries: [projectionEntry, { ...secondProjectionEntry, position: 0 }],
      },
    },
    {
      name: "projection-rejects-position-gaps",
      schema: "SkillSetProjectionV1",
      valid: false,
      value: {
        ...projection,
        entries: [projectionEntry, { ...secondProjectionEntry, position: 2 }],
      },
    },
    {
      name: "projection-rejects-out-of-order-positions",
      schema: "SkillSetProjectionV1",
      valid: false,
      value: {
        ...projection,
        entries: [secondProjectionEntry, projectionEntry],
      },
    },
    {
      name: "projection-rejects-duplicate-skill-ids",
      schema: "SkillSetProjectionV1",
      valid: false,
      value: {
        ...projection,
        entries: [
          {
            ...projectionEntry,
            skillId: secondProjectionEntry.skillId,
          },
          {
            ...secondProjectionEntry,
            skillId: secondProjectionEntry.skillId.toUpperCase(),
          },
        ],
      },
    },
    {
      name: "generated-add-candidate-forbids-skill-id",
      schema: "GeneratedSkillCandidateV1",
      valid: false,
      value: { ...generatedCandidate, skillId: UUID.skill },
    },
    {
      name: "generated-add-candidate-forbids-parent-version-id",
      schema: "GeneratedSkillCandidateV1",
      valid: false,
      value: { ...generatedCandidate, parentVersionId: UUID.version },
    },
    {
      name: "generated-remove-candidate-requires-non-empty-removal-intent",
      schema: "GeneratedSkillCandidateV1",
      valid: false,
      value: {
        ...generatedCandidate,
        action: "remove",
        skillId: UUID.skill,
        parentVersionId: UUID.version,
        bundle: null,
        removalIntent: {},
      },
    },
    {
      name: "generated-bundle-accepts-safe-relative-paths",
      schema: "GeneratedSkillCandidateV1",
      valid: true,
      value: {
        ...generatedCandidate,
        bundle: {
          rootDirectoryName: "idempotent-retries-2",
          files: [
            ...generatedCandidate.bundle.files,
            {
              path: "references/caf\u00e9.txt",
              contentBase64: "cmVmZXJlbmNl",
            },
          ],
        },
      },
    },
    {
      name: "generated-bundle-rejects-invalid-root",
      schema: "GeneratedSkillCandidateV1",
      valid: false,
      value: {
        ...generatedCandidate,
        bundle: { ...generatedCandidate.bundle, rootDirectoryName: "a/b" },
      },
    },
    {
      name: "generated-bundle-rejects-traversal-path",
      schema: "GeneratedSkillCandidateV1",
      valid: false,
      value: {
        ...generatedCandidate,
        bundle: {
          ...generatedCandidate.bundle,
          files: [
            ...generatedCandidate.bundle.files,
            { path: "../escape.txt", contentBase64: "eA==" },
          ],
        },
      },
    },
    {
      name: "generated-bundle-rejects-absolute-path",
      schema: "GeneratedSkillCandidateV1",
      valid: false,
      value: {
        ...generatedCandidate,
        bundle: {
          ...generatedCandidate.bundle,
          files: [
            ...generatedCandidate.bundle.files,
            { path: "C:/escape.txt", contentBase64: "eA==" },
          ],
        },
      },
    },
    {
      name: "generated-bundle-rejects-backslash-path",
      schema: "GeneratedSkillCandidateV1",
      valid: false,
      value: {
        ...generatedCandidate,
        bundle: {
          ...generatedCandidate.bundle,
          files: [
            ...generatedCandidate.bundle.files,
            { path: "references\\escape.txt", contentBase64: "eA==" },
          ],
        },
      },
    },
    {
      name: "generated-bundle-rejects-normalized-path-collision",
      schema: "GeneratedSkillCandidateV1",
      valid: false,
      value: {
        ...generatedCandidate,
        bundle: {
          ...generatedCandidate.bundle,
          files: [
            ...generatedCandidate.bundle.files,
            { path: "caf\u00e9.txt", contentBase64: "bGVmdA==" },
            { path: "cafe\u0301.txt", contentBase64: "cmlnaHQ=" },
          ],
        },
      },
    },
    {
      name: "generated-bundle-rejects-missing-skill-md",
      schema: "GeneratedSkillCandidateV1",
      valid: false,
      value: {
        ...generatedCandidate,
        bundle: {
          ...generatedCandidate.bundle,
          files: [{ path: "README.md", contentBase64: "eA==" }],
        },
      },
    },
    {
      name: "generated-bundle-rejects-root-prefixed-skill-md",
      schema: "GeneratedSkillCandidateV1",
      valid: false,
      value: {
        ...generatedCandidate,
        bundle: {
          ...generatedCandidate.bundle,
          files: [
            {
              path: "idempotent-retries/SKILL.md",
              contentBase64: "IyBTa2lsbA==",
            },
          ],
        },
      },
    },
    {
      name: "generated-bundle-rejects-empty-file-content",
      schema: "GeneratedSkillCandidateV1",
      valid: false,
      value: {
        ...generatedCandidate,
        bundle: {
          ...generatedCandidate.bundle,
          files: [
            ...generatedCandidate.bundle.files,
            { path: "empty.bin", contentBase64: "" },
          ],
        },
      },
    },
    ...(
      [
        ["missing-padding", "AA"],
        ["malformed-padding", "AA="],
        ["excess-padding", "AA==="],
        ["interior-padding", "A=AA"],
        ["url-safe-alphabet", "__8="],
        ["whitespace", "AA==\n"],
        ["invalid-alphabet", "AA!="],
        ["non-zero-one-byte-pad-bits", "AB=="],
        ["non-zero-two-byte-pad-bits", "AAB="],
      ] as const
    ).map(([suffix, contentBase64]) => ({
      name: `generated-bundle-rejects-base64-${suffix}`,
      schema: "GeneratedSkillCandidateV1" as const,
      valid: false,
      value: {
        ...generatedCandidate,
        bundle: {
          ...generatedCandidate.bundle,
          files: [
            ...generatedCandidate.bundle.files,
            { path: "asset.bin", contentBase64 },
          ],
        },
      },
    })),
    {
      name: "create-learning-run-rejects-inverted-selection-interval",
      schema: "CreateLearningRunV1",
      valid: false,
      value: {
        ...(canonicalValidValues.CreateLearningRunV1 as Record<
          string,
          JsonValue
        >),
        selectedAfterSequence: 2,
        selectedThroughSequence: 1,
        snapshotIdsAndHashes: [],
      },
    },
    {
      name: "create-learning-run-rejects-snapshot-outside-selection-interval",
      schema: "CreateLearningRunV1",
      valid: false,
      value: {
        ...(canonicalValidValues.CreateLearningRunV1 as Record<
          string,
          JsonValue
        >),
        selectedAfterSequence: 1,
        selectedThroughSequence: 2,
      },
    },
    {
      name: "create-learning-run-rejects-non-increasing-snapshot-sequences",
      schema: "CreateLearningRunV1",
      valid: false,
      value: {
        ...(canonicalValidValues.CreateLearningRunV1 as Record<
          string,
          JsonValue
        >),
        selectedThroughSequence: 2,
        snapshotIdsAndHashes: [
          snapshotIdentity,
          {
            snapshotId: UUID.annotation,
            contentSha256: SHA_B,
            containerSequence: 1,
          },
        ],
      },
    },
    {
      name: "create-learning-run-rejects-case-variant-snapshot-identities",
      schema: "CreateLearningRunV1",
      valid: false,
      value: {
        ...(canonicalValidValues.CreateLearningRunV1 as Record<
          string,
          JsonValue
        >),
        selectedThroughSequence: 2,
        snapshotIdsAndHashes: [
          snapshotIdentity,
          {
            ...snapshotIdentity,
            snapshotId: UUID.snapshot.toUpperCase(),
            contentSha256: SHA_B,
            containerSequence: 2,
          },
        ],
      },
    },
    {
      name: "create-learning-run-rejects-annotation-outside-frozen-snapshots",
      schema: "CreateLearningRunV1",
      valid: false,
      value: {
        ...(canonicalValidValues.CreateLearningRunV1 as Record<
          string,
          JsonValue
        >),
        selectedAnnotations: [
          { ...selectedAnnotation, targetSnapshotId: UUID.container },
        ],
      },
    },
    {
      name: "create-learning-run-resolves-annotation-snapshot-case-insensitively",
      schema: "CreateLearningRunV1",
      valid: true,
      value: {
        ...(canonicalValidValues.CreateLearningRunV1 as Record<
          string,
          JsonValue
        >),
        selectedAnnotations: [
          {
            ...selectedAnnotation,
            targetSnapshotId: UUID.snapshot.toUpperCase(),
          },
        ],
      },
    },
    {
      name: "append-learning-run-chunk-rejects-mismatched-chunk-identity",
      schema: "AppendLearningRunChunkV1",
      valid: false,
      value: {
        ...(canonicalValidValues.AppendLearningRunChunkV1 as Record<
          string,
          JsonValue
        >),
        chunkIndex: 1,
      },
    },
    {
      name: "learning-run-job-rejects-negative-fence-generation",
      schema: "LearningRunJobV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningRunJobV1 as Record<string, JsonValue>),
        fenceGeneration: -1,
      },
    },
    {
      name: "learning-run-execution-result-rejects-invalid-output-hash",
      schema: "LearningRunExecutionResultV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningRunExecutionResultV1 as Record<
          string,
          JsonValue
        >),
        outputSha256: "invalid",
      },
    },
    {
      name: "learning-run-execution-result-rejects-zero-chunk-output",
      schema: "LearningRunExecutionResultV1",
      valid: false,
      value: {
        ...(canonicalValidValues.LearningRunExecutionResultV1 as Record<
          string,
          JsonValue
        >),
        chunks: [],
      },
    },
    {
      name: "learning-run-execution-result-accepts-multiple-chunks",
      schema: "LearningRunExecutionResultV1",
      valid: true,
      value: {
        ...(canonicalValidValues.LearningRunExecutionResultV1 as Record<
          string,
          JsonValue
        >),
        chunks: [learningChunk, secondLearningChunk],
      },
    },
    ...(
      [
        [
          "mixed-run-ids",
          [
            learningChunk,
            { ...secondLearningChunk, learningRunId: UUID.skill },
          ],
        ],
        [
          "mixed-attempt-ids",
          [learningChunk, { ...secondLearningChunk, attemptId: UUID.version }],
        ],
        [
          "mixed-run-and-attempt-ids",
          [
            learningChunk,
            {
              ...secondLearningChunk,
              learningRunId: UUID.skill,
              attemptId: UUID.version,
            },
          ],
        ],
        [
          "duplicate-chunk-indexes",
          [learningChunk, { ...secondLearningChunk, chunkIndex: 0 }],
        ],
        [
          "gapped-chunk-indexes",
          [learningChunk, { ...secondLearningChunk, chunkIndex: 2 }],
        ],
        ["out-of-order-chunk-indexes", [secondLearningChunk, learningChunk]],
        [
          "overlapping-snapshot-ranges",
          [
            learningChunk,
            {
              ...secondLearningChunk,
              snapshotRange: {
                ...secondLearningChunk.snapshotRange,
                firstSequence: 1,
              },
            },
          ],
        ],
        [
          "out-of-order-snapshot-ranges",
          [
            {
              ...learningChunk,
              snapshotRange: {
                ...learningChunk.snapshotRange,
                firstSequence: 2,
                lastSequence: 2,
              },
            },
            {
              ...secondLearningChunk,
              snapshotRange: {
                ...secondLearningChunk.snapshotRange,
                firstSequence: 1,
                lastSequence: 1,
              },
            },
          ],
        ],
      ] satisfies [string, JsonValue[]][]
    ).map(([suffix, chunks]) => ({
      name: `learning-run-execution-result-rejects-${suffix}`,
      schema: "LearningRunExecutionResultV1" as const,
      valid: false,
      value: {
        ...(canonicalValidValues.LearningRunExecutionResultV1 as Record<
          string,
          JsonValue
        >),
        chunks,
      },
    })),
    {
      name: "run-snapshot-rejects-non-terminal-event-at-terminal-id",
      schema: "RunSnapshotV1",
      valid: false,
      value: {
        ...(canonicalValidValues.RunSnapshotV1 as Record<string, JsonValue>),
        sourceEvents: [sourceEvent],
      },
    },
    {
      name: "run-snapshot-rejects-wrong-terminal-type-at-terminal-id",
      schema: "RunSnapshotV1",
      valid: false,
      value: {
        ...(canonicalValidValues.RunSnapshotV1 as Record<string, JsonValue>),
        sourceEvents: [{ ...terminalSourceEvent, type: "RUN_FINISHED" }],
      },
    },
    {
      name: "run-snapshot-rejects-second-terminal-event",
      schema: "RunSnapshotV1",
      valid: false,
      value: {
        ...(canonicalValidValues.RunSnapshotV1 as Record<string, JsonValue>),
        sourceEvents: [
          terminalSourceEvent,
          {
            ...terminalSourceEvent,
            eventId: "event_2",
            sequence: 2,
            type: "RUN_ERROR",
            sha256: SHA_B,
          },
        ],
      },
    },
    {
      name: "remove-candidate-requires-removal-intent",
      schema: "SkillCandidateV1",
      valid: false,
      value: { ...removeCandidate, removalIntent: null },
    },
    {
      name: "remove-candidate-forbids-bundle",
      schema: "SkillCandidateV1",
      valid: false,
      value: {
        ...removeCandidate,
        bundleLocator: blobLocator,
        bundleSha256: SHA_B,
      },
    },
    {
      name: "add-candidate-forbids-removal-intent",
      schema: "SkillCandidateV1",
      valid: false,
      value: {
        ...addCandidate,
        removalIntent: { reasonCode: "unsafe_behavior" },
      },
    },
    {
      name: "add-candidate-forbids-removal-intent-sha256",
      schema: "SkillCandidateV1",
      valid: false,
      value: {
        ...addCandidate,
        removalIntentSha256: SHA_B,
      },
    },
    {
      name: "update-candidate-forbids-removal-intent",
      schema: "SkillCandidateV1",
      valid: false,
      value: {
        ...updateCandidate,
        removalIntent: { reasonCode: "unsafe_behavior" },
      },
    },
    {
      name: "update-candidate-forbids-removal-intent-sha256",
      schema: "SkillCandidateV1",
      valid: false,
      value: {
        ...updateCandidate,
        removalIntentSha256: SHA_B,
      },
    },
    {
      name: "add-candidate-rejects-subject-hash-mismatch",
      schema: "SkillCandidateV1",
      valid: false,
      value: { ...addCandidate, subjectSha256: SHA_B },
    },
    {
      name: "update-candidate-rejects-subject-hash-mismatch",
      schema: "SkillCandidateV1",
      valid: false,
      value: { ...updateCandidate, subjectSha256: SHA_B },
    },
    {
      name: "add-candidate-rejects-locator-hash-mismatch",
      schema: "SkillCandidateV1",
      valid: false,
      value: {
        ...addCandidate,
        bundleLocator: { ...blobLocator, applicationSha256: SHA_B },
      },
    },
    {
      name: "update-candidate-rejects-locator-hash-mismatch",
      schema: "SkillCandidateV1",
      valid: false,
      value: {
        ...updateCandidate,
        bundleLocator: { ...blobLocator, applicationSha256: SHA_B },
      },
    },
    {
      name: "remove-candidate-rejects-subject-hash-mismatch",
      schema: "SkillCandidateV1",
      valid: false,
      value: { ...removeCandidate, subjectSha256: SHA_A },
    },
    {
      name: "stable-error-valid",
      schema: "LearningPlatformErrorResponseV1",
      valid: true,
      value: canonicalValidValues.LearningPlatformErrorResponseV1,
    },
    {
      name: "stable-error-unknown-code",
      schema: "LearningPlatformErrorResponseV1",
      valid: false,
      value: {
        error: {
          code: "UNKNOWN",
          message: "Unknown error.",
          category: "internal",
          retryable: false,
        },
        requestId: "request_1",
        traceId: "trace_1",
      },
    },
    {
      name: "stable-error-job-launch-failed",
      schema: "LearningPlatformErrorResponseV1",
      valid: true,
      value: {
        error: {
          code: "LEARNING_JOB_LAUNCH_FAILED",
          message: "The Learning job could not be launched.",
          category: "dependency_unavailable",
          retryable: true,
        },
        requestId: "req_job_launch",
        traceId: "trace_job_launch",
      },
    },
    {
      name: "stable-error-rejects-obsolete-candidate-stale-parent",
      schema: "LearningPlatformErrorResponseV1",
      valid: false,
      value: {
        error: {
          code: "LEARNING_CANDIDATE_STALE_PARENT",
          message: "Obsolete error alias.",
          category: "conflict",
          retryable: false,
        },
        requestId: "req_alias",
        traceId: "trace_alias",
      },
    },
    {
      name: "stable-error-rejects-obsolete-candidate-subject-mismatch",
      schema: "LearningPlatformErrorResponseV1",
      valid: false,
      value: {
        error: {
          code: "LEARNING_CANDIDATE_SUBJECT_MISMATCH",
          message: "Obsolete error alias.",
          category: "conflict",
          retryable: false,
        },
        requestId: "req_alias",
        traceId: "trace_alias",
      },
    },
    {
      name: "stable-error-rejects-obsolete-candidate-gates-incomplete",
      schema: "LearningPlatformErrorResponseV1",
      valid: false,
      value: {
        error: {
          code: "LEARNING_CANDIDATE_GATES_INCOMPLETE",
          message: "Obsolete error alias.",
          category: "conflict",
          retryable: false,
        },
        requestId: "req_alias",
        traceId: "trace_alias",
      },
    },
  );

  return cases.map((entry) => ({
    ...entry,
    value: cloneJsonValue(entry.value),
  }));
}

function sortJsonKeys(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, sortJsonKeys(entry)]),
    );
  }
  return value as JsonValue;
}

/** Builds the in-memory corpus solely from canonical schemas and fixed fixtures. */
export function buildLearningPlatformConformanceCorpus(): LearningPlatformConformanceCorpus {
  const schemas = Object.fromEntries(
    Object.entries(learningPlatformConformanceSchemas).map(([name, schema]) => [
      name,
      toLearningContractJsonSchema(schema),
    ]),
  ) as unknown as Record<LearningPlatformConformanceSchemaName, JsonValue>;

  return {
    schemaVersion: 1,
    metaSchemas: {
      [COPILOTKIT_CANDIDATE_SEMANTICS_META_SCHEMA_URI]: cloneJsonValue(
        learningContractCandidateSemanticsMetaSchema,
      ),
    },
    schemas,
    cases: buildCases(),
  };
}

/** Serializes stable-key-ordered UTF-8 JSON with exactly one trailing newline. */
export function serializeLearningPlatformConformanceCorpus(): string {
  return `${JSON.stringify(
    sortJsonKeys(buildLearningPlatformConformanceCorpus()),
    null,
    2,
  )}\n`;
}
