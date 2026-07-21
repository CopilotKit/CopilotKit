import { z } from "zod/v4";
import type { LearningContractAssertionV1 } from "./portable-validator.js";

const nonEmptyStringSchema = z.string().min(1);
const canonicalBase64Schema = z
  .string()
  .min(1)
  .regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?(?![\s\S])/u,
    "Expected canonical RFC 4648 base64",
  );
const SAFE_RELATIVE_PATH_PATTERN =
  "^(?![A-Za-z]:)(?!.*[\\u0000-\\u001F\\u007F\\\\])(?!(?:.*\\/)?\\.{1,2}(?:\\/|$))[^/]+(?:\\/[^/]+)*(?![\\s\\S])";
const safeRelativePathSchema = z
  .string()
  .max(512)
  .regex(
    new RegExp(SAFE_RELATIVE_PATH_PATTERN, "u"),
    "Expected a safe relative slash-delimited path",
  );
function normalizedPathCollisionIndexes(
  paths: readonly string[],
  normalizationForm: "NFC" | "NFKC",
): number[] {
  const collisionKeys = new Set<string>();
  const collisionIndexes: number[] = [];
  for (const [index, path] of paths.entries()) {
    const collisionKey = path
      .normalize(normalizationForm)
      .toLocaleLowerCase("en-US");
    if (collisionKeys.has(collisionKey)) collisionIndexes.push(index);
    collisionKeys.add(collisionKey);
  }
  return collisionIndexes;
}
const skillRootDirectoryNameSchema = z
  .string()
  .max(512)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/u,
    "Expected a single kebab-case root directory name",
  );
const idSchema = nonEmptyStringSchema;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
export const nonNilUuidSchema = z
  .uuid()
  .refine((value) => value !== NIL_UUID, "Expected non-nil UUID")
  .meta({ not: { const: NIL_UUID } });
const uuidSchema = nonNilUuidSchema;
/** Canonical trusted-BFF learning container assignment value. */
export const learningContainerIdSchema = uuidSchema.nullable();
const nonNegativeIntegerSchema = z.int().nonnegative();
const positiveIntegerSchema = z.int().positive();
const MAX_SKILL_POSITION = 999_999;
const timestampSchema = z.iso.datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, "Expected lowercase SHA-256");
const workerEnvelopeShape = {
  schemaVersion: z.literal(1),
  requestId: nonEmptyStringSchema,
  traceId: nonEmptyStringSchema,
} as const;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

/** JSON-compatible value that rejects non-finite numbers and class instances. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

/** Canonical project-scoped learning container read model. */
export const learningContainerV1Schema = z.looseObject({
  schemaVersion: z.literal(1),
  id: uuidSchema,
  organizationId: idSchema,
  projectId: idSchema,
  name: nonEmptyStringSchema,
  description: z.string().nullable(),
  learningEnabled: z.boolean(),
  autoApproveSkillChanges: z.boolean(),
  modelProfileRef: nonEmptyStringSchema,
  promptProfileRef: nonEmptyStringSchema,
  evaluatorProfileRef: nonEmptyStringSchema,
  watermarkSequence: nonNegativeIntegerSchema,
  configRevision: nonNegativeIntegerSchema,
  archiveFence: nonNegativeIntegerSchema,
  archivedAt: nullableTimestampSchema,
  consumptionRevokedAt: nullableTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type LearningContainerV1 = z.infer<typeof learningContainerV1Schema>;

/** Thread assignment fields returned by runtime/control-plane APIs. */
export const threadAssignmentV1Schema = z.looseObject({
  learningContainerId: learningContainerIdSchema,
  assignmentRevision: nonNegativeIntegerSchema,
});
export type ThreadAssignmentV1 = z.infer<typeof threadAssignmentV1Schema>;

/** Optimistic control-plane assignment mutation. */
export const threadAssignmentPatchV1Schema = z.looseObject({
  learningContainerId: learningContainerIdSchema,
  expectedLearningContainerId: learningContainerIdSchema,
});
export type ThreadAssignmentPatchV1 = z.infer<
  typeof threadAssignmentPatchV1Schema
>;

export const normalizedToolCallV1Schema = z.looseObject({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  argsText: z.string(),
});
export type NormalizedToolCallV1 = z.infer<typeof normalizedToolCallV1Schema>;

export const normalizedToolResultV1Schema = z.looseObject({
  toolCallId: nonEmptyStringSchema,
  name: nonEmptyStringSchema.optional(),
  status: z.enum(["ok", "error", "unknown"]),
  output: jsonValueSchema,
});
export type NormalizedToolResultV1 = z.infer<
  typeof normalizedToolResultV1Schema
>;

/** Lossless normalized message used by snapshots and workflow inputs. */
export const normalizedMessageV1Schema = z.looseObject({
  messageId: nonEmptyStringSchema,
  role: nonEmptyStringSchema,
  content: jsonValueSchema,
  toolCalls: z.array(normalizedToolCallV1Schema),
  toolResults: z.array(normalizedToolResultV1Schema),
  eventIds: z.array(nonEmptyStringSchema),
  timestamp: nullableTimestampSchema,
});
export type NormalizedMessageV1 = z.infer<typeof normalizedMessageV1Schema>;

export const sourceEventManifestEntryV1Schema = z.looseObject({
  eventId: nonEmptyStringSchema,
  sequence: z.union([nonNegativeIntegerSchema, nonEmptyStringSchema]),
  cursor: nonEmptyStringSchema.optional(),
  type: nonEmptyStringSchema,
  sha256: sha256Schema,
});
export type SourceEventManifestEntryV1 = z.infer<
  typeof sourceEventManifestEntryV1Schema
>;

/** Complete immutable first-terminal-event snapshot. */
export const runSnapshotV1Schema = z
  .looseObject({
    schemaVersion: z.literal(1),
    snapshotId: uuidSchema,
    organizationId: idSchema,
    projectId: idSchema,
    learningContainerId: uuidSchema,
    threadId: idSchema,
    agentRunId: nonEmptyStringSchema,
    externalRunId: nonEmptyStringSchema,
    terminalEventId: nonEmptyStringSchema,
    terminalType: z.enum(["RUN_FINISHED", "RUN_ERROR"]),
    terminalStatus: z.string().nullable(),
    startedAt: timestampSchema,
    terminalAt: timestampSchema,
    capturedAt: timestampSchema,
    assignmentRevision: nonNegativeIntegerSchema,
    sourceEvents: z.array(sourceEventManifestEntryV1Schema),
    messages: z.array(normalizedMessageV1Schema),
    stateChanges: z.array(jsonObjectSchema),
    annotations: z.array(jsonObjectSchema),
    attachments: z.array(jsonObjectSchema),
    normalizerVersion: nonEmptyStringSchema,
    sanitizerVersion: nonEmptyStringSchema,
    contentSha256: sha256Schema,
    byteLength: nonNegativeIntegerSchema,
    tokenEstimate: nonNegativeIntegerSchema,
    containerSequence: positiveIntegerSchema,
  })
  .superRefine((snapshot, context) => {
    const referencedTerminalEvents = snapshot.sourceEvents.filter(
      ({ eventId }) => eventId === snapshot.terminalEventId,
    );
    if (referencedTerminalEvents.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["sourceEvents"],
        message: "Source events must contain exactly one terminal event",
      });
    }
    const referencedTerminalEvent = referencedTerminalEvents[0];
    if (
      referencedTerminalEvent !== undefined &&
      referencedTerminalEvent.type !== snapshot.terminalType
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceEvents"],
        message: "Referenced terminal event type must match terminalType",
      });
    }
    const terminalTypedEvents = snapshot.sourceEvents.filter(
      ({ type }) => type === "RUN_FINISHED" || type === "RUN_ERROR",
    );
    if (terminalTypedEvents.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["sourceEvents"],
        message: "Source events must contain exactly one terminal-typed event",
      });
    }

    if (Date.parse(snapshot.startedAt) > Date.parse(snapshot.terminalAt)) {
      context.addIssue({
        code: "custom",
        path: ["terminalAt"],
        message: "Terminal time cannot precede start time",
      });
    }
    if (Date.parse(snapshot.terminalAt) > Date.parse(snapshot.capturedAt)) {
      context.addIssue({
        code: "custom",
        path: ["capturedAt"],
        message: "Capture time cannot precede terminal time",
      });
    }
  });
export type RunSnapshotV1 = z.infer<typeof runSnapshotV1Schema>;

export const evidenceLocatorV1Schema = z.looseObject({
  messageIds: z.array(nonEmptyStringSchema),
  eventIds: z.array(nonEmptyStringSchema),
});
export type EvidenceLocatorV1 = z.infer<typeof evidenceLocatorV1Schema>;

/** Frozen evidence-attached human annotation selected for a run. */
export const selectedHumanAnnotationV1Schema = z.looseObject({
  schemaVersion: z.literal(1),
  annotationId: uuidSchema,
  targetSnapshotId: uuidSchema,
  targetEvidenceLocator: evidenceLocatorV1Schema.nullable(),
  text: nonEmptyStringSchema,
  contentSha256: sha256Schema,
  annotationRevision: nonNegativeIntegerSchema,
  authoredAt: timestampSchema,
  capturedAt: timestampSchema,
});
export type SelectedHumanAnnotationV1 = z.infer<
  typeof selectedHumanAnnotationV1Schema
>;

export const snapshotIdentityV1Schema = z.looseObject({
  snapshotId: uuidSchema,
  contentSha256: sha256Schema,
  containerSequence: positiveIntegerSchema,
});

export const learningRunStatusV1Schema = z.enum([
  "created",
  "job_requested",
  "queued",
  "running",
  "finalizing",
  "succeeded",
  "retry_wait",
  "dead_lettered",
  "cancelled",
]);

/** Complete immutable manifest shared by create commands and durable runs. */
export const learningRunFrozenManifestV1Schema = z
  .looseObject({
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
  .superRefine((manifest, context) => {
    if (manifest.selectedAfterSequence > manifest.selectedThroughSequence) {
      context.addIssue({
        code: "custom",
        path: ["selectedThroughSequence"],
        message: "Selected-through sequence cannot precede selected-after",
      });
    }

    const snapshotIds = new Set<string>();
    let previousSequence: number | undefined;
    for (const [index, snapshot] of manifest.snapshotIdsAndHashes.entries()) {
      const snapshotId = snapshot.snapshotId.toLowerCase();
      if (snapshotIds.has(snapshotId)) {
        context.addIssue({
          code: "custom",
          path: ["snapshotIdsAndHashes", index, "snapshotId"],
          message: "Frozen snapshot identities must be unique",
        });
      }
      snapshotIds.add(snapshotId);

      if (
        snapshot.containerSequence <= manifest.selectedAfterSequence ||
        snapshot.containerSequence > manifest.selectedThroughSequence
      ) {
        context.addIssue({
          code: "custom",
          path: ["snapshotIdsAndHashes", index, "containerSequence"],
          message: "Frozen snapshot sequence is outside the selected interval",
        });
      }
      if (
        previousSequence !== undefined &&
        snapshot.containerSequence <= previousSequence
      ) {
        context.addIssue({
          code: "custom",
          path: ["snapshotIdsAndHashes", index, "containerSequence"],
          message: "Frozen snapshot sequences must be strictly increasing",
        });
      }
      previousSequence = snapshot.containerSequence;
    }

    for (const [index, annotation] of manifest.selectedAnnotations.entries()) {
      if (!snapshotIds.has(annotation.targetSnapshotId.toLowerCase())) {
        context.addIssue({
          code: "custom",
          path: ["selectedAnnotations", index, "targetSnapshotId"],
          message: "Selected annotation must target a frozen snapshot",
        });
      }
    }
  });
export type LearningRunFrozenManifestV1 = z.infer<
  typeof learningRunFrozenManifestV1Schema
>;

/** Durable learning run and its immutable frozen manifest. */
export const learningRunV1Schema = learningRunFrozenManifestV1Schema.safeExtend(
  {
    status: learningRunStatusV1Schema,
    createdAt: timestampSchema,
    startedAt: nullableTimestampSchema,
    completedAt: nullableTimestampSchema,
  },
);
export type LearningRunV1 = z.infer<typeof learningRunV1Schema>;

export const learningChunkV1Schema = z.looseObject({
  learningRunId: uuidSchema,
  attemptId: uuidSchema,
  chunkIndex: nonNegativeIntegerSchema,
  snapshotRange: z
    .looseObject({
      firstSnapshotId: uuidSchema,
      lastSnapshotId: uuidSchema,
      firstSequence: positiveIntegerSchema,
      lastSequence: positiveIntegerSchema,
    })
    .refine((range) => range.firstSequence <= range.lastSequence, {
      path: ["lastSequence"],
      message: "Last snapshot sequence cannot precede first sequence",
    }),
  inputSha256: sha256Schema,
  outputSha256: sha256Schema.nullable(),
  status: z.enum([
    "planned",
    "running",
    "staged",
    "failed",
    "discarded",
    "promoted",
  ]),
  privatePayloadRef: jsonValueSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type LearningChunkV1 = z.infer<typeof learningChunkV1Schema>;

export const evidenceRefV1Schema = z.discriminatedUnion("evidenceType", [
  z.looseObject({
    evidenceType: z.literal("run_snapshot"),
    snapshotId: uuidSchema,
    snapshotSha256: sha256Schema,
    annotationId: z.null().optional(),
    annotationSha256: z.null().optional(),
    threadId: idSchema,
    externalRunId: nonEmptyStringSchema,
    messageIds: z.array(nonEmptyStringSchema),
    eventIds: z.array(nonEmptyStringSchema),
    excerpt: z.string().nullable(),
    excerptSha256: sha256Schema.nullable(),
    truncated: z.boolean(),
  }),
  z.looseObject({
    evidenceType: z.literal("human_annotation"),
    snapshotId: uuidSchema,
    snapshotSha256: sha256Schema,
    annotationId: uuidSchema,
    annotationSha256: sha256Schema,
    threadId: idSchema,
    externalRunId: nonEmptyStringSchema,
    messageIds: z.array(nonEmptyStringSchema),
    eventIds: z.array(nonEmptyStringSchema),
    excerpt: z.string().nullable(),
    excerptSha256: sha256Schema.nullable(),
    truncated: z.boolean(),
  }),
]);
export type EvidenceRefV1 = z.infer<typeof evidenceRefV1Schema>;

export const insightKindV1Schema = z.enum([
  "agent_behavior",
  "user_product",
  "workflow",
  "system_quality",
]);

/** Immutable evidence-backed product insight. */
export const insightV1Schema = z.looseObject({
  schemaVersion: z.literal(1),
  id: uuidSchema,
  organizationId: idSchema,
  projectId: idSchema,
  learningContainerId: uuidSchema,
  learningRunId: uuidSchema,
  workflowOutputAlias: nonEmptyStringSchema,
  kind: insightKindV1Schema,
  statement: nonEmptyStringSchema,
  impact: nonEmptyStringSchema,
  confidence: z.number().finite().min(0).max(1),
  skillEligible: z.boolean(),
  evidenceRefs: z.array(evidenceRefV1Schema).min(1),
  createdAt: timestampSchema,
});
export type InsightV1 = z.infer<typeof insightV1Schema>;

export const insightFeedbackV1Schema = z.looseObject({
  schemaVersion: z.literal(1),
  id: uuidSchema,
  insightId: uuidSchema,
  actor: nonEmptyStringSchema,
  rating: nonEmptyStringSchema,
  note: z.string().nullable().optional(),
  createdAt: timestampSchema,
});
export type InsightFeedbackV1 = z.infer<typeof insightFeedbackV1Schema>;

export const insightAnnotationV1Schema = z.looseObject({
  schemaVersion: z.literal(1),
  id: uuidSchema,
  insightId: uuidSchema,
  evidenceTarget: evidenceLocatorV1Schema.nullable().optional(),
  actor: nonEmptyStringSchema,
  text: nonEmptyStringSchema,
  revision: positiveIntegerSchema,
  createdAt: timestampSchema,
});
export type InsightAnnotationV1 = z.infer<typeof insightAnnotationV1Schema>;

export const insightArchiveEventV1Schema = z.looseObject({
  schemaVersion: z.literal(1),
  id: uuidSchema,
  insightId: uuidSchema,
  archived: z.boolean(),
  actor: nonEmptyStringSchema,
  createdAt: timestampSchema,
});
export type InsightArchiveEventV1 = z.infer<typeof insightArchiveEventV1Schema>;

export const skillArtifactFileV1Schema = z.looseObject({
  path: safeRelativePathSchema,
  role: nonEmptyStringSchema,
  mediaType: nonEmptyStringSchema,
  byteLength: nonNegativeIntegerSchema,
  rawSha256: sha256Schema,
});
export type SkillArtifactFileV1 = z.infer<typeof skillArtifactFileV1Schema>;

export const skillArtifactManifestV1Schema = z
  .looseObject({
    manifestVersion: z.literal(1),
    agentSkillsProfile: nonEmptyStringSchema,
    files: z.array(skillArtifactFileV1Schema).min(1),
    manifestSha256: sha256Schema,
    bundleSha256: sha256Schema,
    bundleByteLength: positiveIntegerSchema,
    provenance: jsonObjectSchema,
  })
  .superRefine((manifest, context) => {
    for (const index of normalizedPathCollisionIndexes(
      manifest.files.map(({ path }) => path),
      "NFC",
    )) {
      context.addIssue({
        code: "custom",
        path: ["files", index, "path"],
        message:
          "Artifact manifest file paths must be unique after normalization",
      });
    }
    if (!manifest.files.some(({ path }) => path === "SKILL.md")) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Artifact manifest must contain root-relative SKILL.md",
      });
    }
  });
export type SkillArtifactManifestV1 = z.infer<
  typeof skillArtifactManifestV1Schema
>;

/** Provider-neutral immutable object locator; canonical bytes never use local storage. */
export const blobLocatorV1Schema = z.looseObject({
  schemaVersion: z.literal(1),
  backendId: nonEmptyStringSchema,
  provider: z.enum([
    "awsS3",
    "googleCloudStorage",
    "azureBlob",
    "s3Compatible",
  ]),
  resource: nonEmptyStringSchema,
  key: nonEmptyStringSchema,
  providerVersion: z.string().nullable(),
  etag: z.string().nullable(),
  applicationSha256: sha256Schema,
  providerChecksum: jsonObjectSchema.nullable(),
  byteLength: nonNegativeIntegerSchema,
  contentType: nonEmptyStringSchema,
});
export type BlobLocatorV1 = z.infer<typeof blobLocatorV1Schema>;

export const skillBundleV1Schema = z
  .looseObject({
    schemaVersion: z.literal(1),
    manifest: skillArtifactManifestV1Schema,
    locator: blobLocatorV1Schema,
  })
  .superRefine((bundle, context) => {
    if (bundle.manifest.bundleSha256 !== bundle.locator.applicationSha256) {
      context.addIssue({
        code: "custom",
        path: ["locator", "applicationSha256"],
        message: "Bundle manifest and locator hashes must match",
      });
    }
    if (bundle.manifest.bundleByteLength !== bundle.locator.byteLength) {
      context.addIssue({
        code: "custom",
        path: ["locator", "byteLength"],
        message: "Bundle manifest and locator byte lengths must match",
      });
    }
  });
export type SkillBundleV1 = z.infer<typeof skillBundleV1Schema>;

export const candidateStatusV1Schema = z.enum([
  "created",
  "pending_gates",
  "blocked",
  "gates_passed",
  "pending_review",
  "publishing",
  "published",
  "publish_retry_wait",
  "stale_parent",
  "rejected",
  "superseded_by_edit",
]);

const skillCandidateBaseShape = {
  candidateId: uuidSchema,
  candidateRevisionId: uuidSchema,
  organizationId: idSchema,
  projectId: idSchema,
  learningContainerId: uuidSchema,
  learningRunId: uuidSchema.nullable(),
  action: z.enum(["add", "update", "remove"]),
  skillId: uuidSchema,
  proposedVersionId: uuidSchema.nullable(),
  parentVersionId: uuidSchema.nullable(),
  bundleLocator: blobLocatorV1Schema.nullable(),
  bundleSha256: sha256Schema.nullable(),
  removalIntent: jsonObjectSchema.nullable(),
  removalIntentSha256: sha256Schema.nullable(),
  subjectSha256: sha256Schema,
  insightIds: z.array(uuidSchema),
  evidenceRefs: z.array(evidenceRefV1Schema),
  reason: nonEmptyStringSchema,
  risk: nonEmptyStringSchema,
  approvalModeSnapshot: z.enum(["manual", "automatic"]),
  evaluatorProfileRef: nonEmptyStringSchema,
  status: candidateStatusV1Schema,
  createdByType: z.enum(["learning", "human"]),
  createdAt: timestampSchema,
} as const;

/** Immutable candidate revision with action-specific full-bundle/removal coherence. */
export const skillCandidateV1Schema = z
  .looseObject(skillCandidateBaseShape)
  .superRefine((candidate, context) => {
    if (
      candidate.action !== "remove" &&
      (candidate.removalIntent !== null ||
        candidate.removalIntentSha256 !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["removalIntent"],
        message: "Add/update candidates forbid removal intent fields",
      });
    }

    if (candidate.action === "add") {
      if (candidate.parentVersionId !== null) {
        context.addIssue({
          code: "custom",
          path: ["parentVersionId"],
          message: "A first add cannot have a parent version",
        });
      }
      if (
        candidate.proposedVersionId === null ||
        candidate.bundleLocator === null ||
        candidate.bundleSha256 === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["bundleLocator"],
          message: "Add candidates require a proposed version and full bundle",
        });
      }
    }

    if (candidate.action === "update") {
      if (
        candidate.parentVersionId === null ||
        candidate.proposedVersionId === null ||
        candidate.bundleLocator === null ||
        candidate.bundleSha256 === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["parentVersionId"],
          message:
            "Update candidates require a parent, proposed version, and full bundle",
        });
      }
    }

    if (candidate.action === "remove") {
      if (
        candidate.parentVersionId === null ||
        candidate.proposedVersionId !== null ||
        candidate.bundleLocator !== null ||
        candidate.bundleSha256 !== null ||
        candidate.removalIntent === null ||
        candidate.removalIntentSha256 === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["removalIntent"],
          message: "Remove candidates require a parent and removal intent only",
        });
      }
    }

    const actionHash =
      candidate.action === "remove"
        ? candidate.removalIntentSha256
        : candidate.bundleSha256;
    if (actionHash !== null && actionHash !== candidate.subjectSha256) {
      context.addIssue({
        code: "custom",
        path: ["subjectSha256"],
        message:
          "Candidate subject hash must equal its bundle or removal-intent hash",
      });
    }
    if (
      candidate.action !== "remove" &&
      candidate.bundleLocator !== null &&
      candidate.bundleSha256 !== null &&
      candidate.bundleLocator.applicationSha256 !== candidate.bundleSha256
    ) {
      context.addIssue({
        code: "custom",
        path: ["bundleLocator", "applicationSha256"],
        message: "Candidate bundle locator and bundle hashes must match",
      });
    }
  });
export type SkillCandidateV1 = z.infer<typeof skillCandidateV1Schema>;

export const candidateGateResultV1Schema = z.looseObject({
  gateResultId: uuidSchema,
  candidateRevisionId: uuidSchema,
  subjectSha256: sha256Schema,
  gate: z.enum([
    "artifact",
    "privacy",
    "provenance",
    "parent_concurrency",
    "behavioral_evaluation",
  ]),
  profileVersion: nonEmptyStringSchema,
  fixtureVersion: z.string().nullable(),
  baselineVersion: z.string().nullable(),
  status: z.enum(["passed", "failed", "inconclusive", "missing"]),
  reasonCode: nonEmptyStringSchema,
  detailsRef: jsonValueSchema.nullable(),
  evaluatedAt: timestampSchema,
});
export type CandidateGateResultV1 = z.infer<typeof candidateGateResultV1Schema>;

export const skillSetProjectionEntryV1Schema = z
  .looseObject({
    skillId: uuidSchema,
    versionId: uuidSchema,
    position: nonNegativeIntegerSchema.max(MAX_SKILL_POSITION),
    name: nonEmptyStringSchema,
    description: z.string().nullable(),
    bundleLocator: blobLocatorV1Schema,
    bundleSha256: sha256Schema,
    manifestSha256: sha256Schema,
    bundleByteLength: positiveIntegerSchema,
    manifest: skillArtifactManifestV1Schema,
    approvalMethod: z.enum(["manual", "automatic"]),
  })
  .superRefine((entry, context) => {
    if (entry.bundleSha256 !== entry.bundleLocator.applicationSha256) {
      context.addIssue({
        code: "custom",
        path: ["bundleLocator", "applicationSha256"],
        message: "Projection entry and locator bundle hashes must match",
      });
    }
    if (entry.bundleByteLength !== entry.bundleLocator.byteLength) {
      context.addIssue({
        code: "custom",
        path: ["bundleLocator", "byteLength"],
        message: "Projection entry and locator byte lengths must match",
      });
    }
    if (entry.manifest.bundleSha256 !== entry.bundleSha256) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "bundleSha256"],
        message: "Projection entry and manifest bundle hashes must match",
      });
    }
    if (entry.manifest.manifestSha256 !== entry.manifestSha256) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "manifestSha256"],
        message: "Projection entry and manifest hashes must match",
      });
    }
    if (entry.manifest.bundleByteLength !== entry.bundleByteLength) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "bundleByteLength"],
        message: "Projection entry and manifest byte lengths must match",
      });
    }
  });
export type SkillSetProjectionEntryV1 = z.infer<
  typeof skillSetProjectionEntryV1Schema
>;

/** Complete ordered runtime projection; an empty projection is valid. */
export const skillSetProjectionV1Schema = z
  .looseObject({
    schemaVersion: z.literal(1),
    learningContainerId: uuidSchema,
    registryRevision: nonEmptyStringSchema,
    skillSetHash: sha256Schema,
    etag: nonEmptyStringSchema,
    entries: z.array(skillSetProjectionEntryV1Schema),
    publishedAt: timestampSchema,
    revoked: z.boolean(),
  })
  .superRefine((projection, context) => {
    if (projection.revoked && projection.entries.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "A revoked projection must not contain entries",
      });
    }

    const skillIds = new Set<string>();
    for (const [index, entry] of projection.entries.entries()) {
      if (entry.position !== index) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "position"],
          message: "Projection positions must be contiguous and ordered",
        });
      }

      const skillId = entry.skillId.toLowerCase();
      if (skillIds.has(skillId)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "skillId"],
          message: "Projection skill IDs must be unique",
        });
      }
      skillIds.add(skillId);
    }
  });
export type SkillSetProjectionV1 = z.infer<typeof skillSetProjectionV1Schema>;

export const workflowThreadV1Schema = z.looseObject({
  snapshotId: uuidSchema,
  snapshotSha256: sha256Schema,
  threadId: idSchema,
  externalRunId: nonEmptyStringSchema,
  messages: z.array(normalizedMessageV1Schema),
});

export const frozenAvailableSkillV1Schema = z.looseObject({
  skillId: uuidSchema,
  versionId: uuidSchema,
  alias: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  description: z.string().nullable(),
  bundle: skillBundleV1Schema,
  registryState: nonEmptyStringSchema,
});

export const learningWorkflowInputV1Schema = z
  .looseObject({
    schemaVersion: z.literal(1),
    threads: z.array(workflowThreadV1Schema),
    selectedAnnotations: z.array(selectedHumanAnnotationV1Schema),
    availableSkills: z.array(frozenAvailableSkillV1Schema),
    promptContext: jsonObjectSchema.nullable(),
    limits: jsonObjectSchema,
  })
  .superRefine((input, context) => {
    const threadIds = new Set<string>();
    const snapshots = new Map<string, (typeof input.threads)[number]>();
    for (const [index, thread] of input.threads.entries()) {
      if (threadIds.has(thread.threadId)) {
        context.addIssue({
          code: "custom",
          path: ["threads", index, "threadId"],
          message: "Workflow thread IDs must be unique",
        });
      }
      threadIds.add(thread.threadId);

      const snapshotId = thread.snapshotId.toLowerCase();
      if (snapshots.has(snapshotId)) {
        context.addIssue({
          code: "custom",
          path: ["threads", index, "snapshotId"],
          message: "Workflow snapshot IDs must be unique",
        });
      } else {
        snapshots.set(snapshotId, thread);
      }
    }

    const skillAliases = new Set<string>();
    for (const [index, skill] of input.availableSkills.entries()) {
      if (skillAliases.has(skill.alias)) {
        context.addIssue({
          code: "custom",
          path: ["availableSkills", index, "alias"],
          message: "Available skill aliases must be unique",
        });
      }
      skillAliases.add(skill.alias);
    }

    for (const [
      annotationIndex,
      annotation,
    ] of input.selectedAnnotations.entries()) {
      const thread = snapshots.get(annotation.targetSnapshotId.toLowerCase());
      if (thread === undefined) {
        context.addIssue({
          code: "custom",
          path: ["selectedAnnotations", annotationIndex, "targetSnapshotId"],
          message: "Selected annotation must target a workflow snapshot",
        });
        continue;
      }
      if (annotation.targetEvidenceLocator === null) {
        continue;
      }

      const messageIds = new Set(
        thread.messages.map((message) => message.messageId),
      );
      const eventIds = new Set(
        thread.messages.flatMap((message) => message.eventIds),
      );
      for (const [
        messageIndex,
        messageId,
      ] of annotation.targetEvidenceLocator.messageIds.entries()) {
        if (!messageIds.has(messageId)) {
          context.addIssue({
            code: "custom",
            path: [
              "selectedAnnotations",
              annotationIndex,
              "targetEvidenceLocator",
              "messageIds",
              messageIndex,
            ],
            message:
              "Selected annotation message must exist in its target snapshot",
          });
        }
      }
      for (const [
        eventIndex,
        eventId,
      ] of annotation.targetEvidenceLocator.eventIds.entries()) {
        if (!eventIds.has(eventId)) {
          context.addIssue({
            code: "custom",
            path: [
              "selectedAnnotations",
              annotationIndex,
              "targetEvidenceLocator",
              "eventIds",
              eventIndex,
            ],
            message:
              "Selected annotation event must exist in its target snapshot messages",
          });
        }
      }
    }
  });
export type LearningWorkflowInputV1 = z.infer<
  typeof learningWorkflowInputV1Schema
>;

export const generatedInsightV1Schema = z.looseObject({
  outputAlias: nonEmptyStringSchema,
  kind: insightKindV1Schema,
  statement: nonEmptyStringSchema,
  impact: nonEmptyStringSchema,
  confidence: z.number().finite().min(0).max(1),
  skillEligible: z.boolean(),
  evidenceRefs: z.array(evidenceRefV1Schema).min(1),
});

const generatedSkillBundleV1Schema = z
  .looseObject({
    rootDirectoryName: skillRootDirectoryNameSchema,
    files: z
      .array(
        z.looseObject({
          path: safeRelativePathSchema,
          contentBase64: canonicalBase64Schema,
        }),
      )
      .min(1),
  })
  .superRefine((bundle, context) => {
    for (const index of normalizedPathCollisionIndexes(
      bundle.files.map(({ path }) => path),
      "NFKC",
    )) {
      context.addIssue({
        code: "custom",
        path: ["files", index, "path"],
        message:
          "Generated bundle file paths must be unique after normalization",
      });
    }
    if (bundle.files.filter(({ path }) => path === "SKILL.md").length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message:
          "Generated bundle must contain exactly one root-relative SKILL.md",
      });
    }
  });

export const generatedSkillCandidateV1Schema = z
  .looseObject({
    outputAlias: nonEmptyStringSchema,
    action: z.enum(["add", "update", "remove"]),
    skillId: uuidSchema.nullable(),
    parentVersionId: uuidSchema.nullable(),
    bundle: generatedSkillBundleV1Schema.nullable(),
    removalIntent: jsonObjectSchema.nullable(),
    insightAliases: z.array(nonEmptyStringSchema).min(1),
    evidenceRefs: z.array(evidenceRefV1Schema),
    reason: nonEmptyStringSchema,
    risk: nonEmptyStringSchema,
  })
  .superRefine((candidate, context) => {
    const requiresBundle =
      candidate.action === "add" || candidate.action === "update";
    if (requiresBundle !== (candidate.bundle !== null)) {
      context.addIssue({
        code: "custom",
        path: ["bundle"],
        message: "Add/update require a full bundle; remove forbids one",
      });
    }
    if (
      (candidate.action === "remove") !==
      (candidate.removalIntent !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["removalIntent"],
        message: "Remove requires a removal intent; add/update forbid one",
      });
    }
    if (
      candidate.action === "remove" &&
      candidate.removalIntent !== null &&
      Object.keys(candidate.removalIntent).length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["removalIntent"],
        message: "Remove requires a non-empty removal intent",
      });
    }
    if (
      (candidate.action === "update" || candidate.action === "remove") &&
      (candidate.skillId === null || candidate.parentVersionId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["parentVersionId"],
        message: "Update/remove require exact target and parent version",
      });
    }
    if (
      candidate.action === "add" &&
      (candidate.skillId !== null || candidate.parentVersionId !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["skillId"],
        message: "Add requires null skill and parent version IDs",
      });
    }
  });

/**
 * Portable JSON Schema keyword for equality between sibling object properties.
 *
 * Each tuple is `[leftProperty, rightProperty]`; a conforming validator MUST
 * reject the object when the two present property values are not equal.
 */
export const COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD =
  "x-copilotkit-equal-properties" as const;
/** Bounded declarative assertions used by portable Learning V1 schemas. */
export const COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD =
  "x-copilotkit-assertions" as const;
export const COPILOTKIT_LEARNING_CONTRACT_SEMANTICS_VOCABULARY_URI =
  "https://copilotkit.ai/schemas/intelligence/learning-platform/v1/candidate-semantics/vocabulary" as const;
export const COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI =
  "https://copilotkit.ai/schemas/intelligence/learning-platform/v1/candidate-semantics" as const;
/** @deprecated Use the generalized Learning Contract vocabulary name. */
export const COPILOTKIT_CANDIDATE_SEMANTICS_VOCABULARY_URI =
  COPILOTKIT_LEARNING_CONTRACT_SEMANTICS_VOCABULARY_URI;
/** @deprecated Use the generalized Learning Contract meta-schema name. */
export const COPILOTKIT_CANDIDATE_SEMANTICS_META_SCHEMA_URI =
  COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI;

const assertionNormalizationJsonSchema: JsonObject = {
  type: "object",
  properties: {
    caseFold: { type: "boolean" },
    unicode: { enum: ["NFC", "NFKC"] },
  },
  additionalProperties: false,
};

const assertionValueTypeJsonSchema: JsonObject = {
  enum: ["number", "string", "date-time"],
};

const assertionJsonPointerJsonSchema: JsonObject = {
  type: "string",
  pattern: "^(?:$|/)",
};

/** JSON Schema for the bounded V1 portable assertion language. */
export const learningContractAssertionV1JsonSchema: JsonObject = {
  type: "array",
  items: {
    oneOf: [
      {
        type: "object",
        properties: {
          operation: { const: "compare" },
          left: assertionJsonPointerJsonSchema,
          relation: {
            enum: ["equal", "less-than", "less-than-or-equal"],
          },
          right: assertionJsonPointerJsonSchema,
          valueType: assertionValueTypeJsonSchema,
          normalization: assertionNormalizationJsonSchema,
        },
        required: ["operation", "left", "relation", "right"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          operation: { const: "unique" },
          values: assertionJsonPointerJsonSchema,
          normalization: assertionNormalizationJsonSchema,
        },
        required: ["operation", "values"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          operation: { const: "strictly-increasing" },
          values: assertionJsonPointerJsonSchema,
          valueType: assertionValueTypeJsonSchema,
        },
        required: ["operation", "values", "valueType"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          operation: { const: "contiguous" },
          values: assertionJsonPointerJsonSchema,
          start: { type: "integer" },
        },
        required: ["operation", "values", "start"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          operation: { const: "values-in-range" },
          values: assertionJsonPointerJsonSchema,
          minimum: assertionJsonPointerJsonSchema,
          maximum: assertionJsonPointerJsonSchema,
          minimumExclusive: { type: "boolean" },
          maximumExclusive: { type: "boolean" },
          valueType: assertionValueTypeJsonSchema,
        },
        required: ["operation", "values", "minimum", "maximum", "valueType"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          operation: { const: "references" },
          values: assertionJsonPointerJsonSchema,
          targets: assertionJsonPointerJsonSchema,
          normalization: assertionNormalizationJsonSchema,
        },
        required: ["operation", "values", "targets"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          operation: { const: "disjoint" },
          left: assertionJsonPointerJsonSchema,
          right: assertionJsonPointerJsonSchema,
          normalization: assertionNormalizationJsonSchema,
        },
        required: ["operation", "left", "right"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          operation: { const: "ordered-ranges" },
          ranges: assertionJsonPointerJsonSchema,
          first: assertionJsonPointerJsonSchema,
          last: assertionJsonPointerJsonSchema,
          valueType: assertionValueTypeJsonSchema,
        },
        required: ["operation", "ranges", "first", "last", "valueType"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          operation: { const: "lookup-equal" },
          collection: assertionJsonPointerJsonSchema,
          key: assertionJsonPointerJsonSchema,
          reference: assertionJsonPointerJsonSchema,
          value: assertionJsonPointerJsonSchema,
          expected: assertionJsonPointerJsonSchema,
          normalization: assertionNormalizationJsonSchema,
        },
        required: [
          "operation",
          "collection",
          "key",
          "reference",
          "value",
          "expected",
        ],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          operation: { const: "lookup-references" },
          sources: assertionJsonPointerJsonSchema,
          reference: assertionJsonPointerJsonSchema,
          values: assertionJsonPointerJsonSchema,
          collection: assertionJsonPointerJsonSchema,
          key: assertionJsonPointerJsonSchema,
          targets: assertionJsonPointerJsonSchema,
          keyNormalization: assertionNormalizationJsonSchema,
          valueNormalization: assertionNormalizationJsonSchema,
        },
        required: [
          "operation",
          "sources",
          "reference",
          "values",
          "collection",
          "key",
          "targets",
        ],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          operation: { const: "count" },
          values: assertionJsonPointerJsonSchema,
          where: {
            type: "object",
            properties: {
              equals: true,
              in: { type: "array" },
            },
            minProperties: 1,
            maxProperties: 1,
            additionalProperties: false,
          },
          exactly: { type: "integer", minimum: 0 },
          minimum: { type: "integer", minimum: 0 },
          maximum: { type: "integer", minimum: 0 },
          normalization: assertionNormalizationJsonSchema,
        },
        required: ["operation", "values"],
        anyOf: [
          { required: ["exactly"] },
          { required: ["minimum"] },
          { required: ["maximum"] },
        ],
        additionalProperties: false,
      },
    ],
  },
};

/** Required meta-schema for the versioned Learning Contract semantics. */
export const learningContractSemanticsMetaSchema: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI,
  $vocabulary: {
    "https://json-schema.org/draft/2020-12/vocab/core": true,
    "https://json-schema.org/draft/2020-12/vocab/applicator": true,
    "https://json-schema.org/draft/2020-12/vocab/unevaluated": true,
    "https://json-schema.org/draft/2020-12/vocab/validation": true,
    "https://json-schema.org/draft/2020-12/vocab/meta-data": true,
    "https://json-schema.org/draft/2020-12/vocab/format-annotation": true,
    "https://json-schema.org/draft/2020-12/vocab/content": true,
    [COPILOTKIT_LEARNING_CONTRACT_SEMANTICS_VOCABULARY_URI]: true,
  },
  $dynamicAnchor: "meta",
  allOf: [{ $ref: "https://json-schema.org/draft/2020-12/schema" }],
  properties: {
    [COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD]: {
      type: "array",
      items: {
        type: "array",
        prefixItems: [
          { type: "string", minLength: 1 },
          { type: "string", minLength: 1 },
        ],
        minItems: 2,
        maxItems: 2,
      },
    },
    [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]:
      learningContractAssertionV1JsonSchema,
  },
};
/** @deprecated Use the generalized Learning Contract meta-schema name. */
export const learningContractCandidateSemanticsMetaSchema =
  learningContractSemanticsMetaSchema;

const portableAssertionsBySchema = new WeakMap<
  object,
  readonly LearningContractAssertionV1[]
>();

/** Associates bounded portable semantics with a canonical Learning schema. */
export function registerLearningContractPortableAssertions(
  schema: z.ZodType,
  assertions: readonly LearningContractAssertionV1[],
): void {
  if (portableAssertionsBySchema.has(schema)) {
    throw new Error("Portable assertions are already registered for schema");
  }
  portableAssertionsBySchema.set(schema, assertions);
}

// oxlint-disable unicorn/no-thenable -- `then` is a JSON Schema keyword here.
const skillCandidateActionJsonSchema: z.core.JSONSchema.JSONSchema[] = [
  {
    if: {
      properties: { action: { const: "add" } },
      required: ["action"],
    },
    then: {
      properties: {
        proposedVersionId: { type: "string" },
        parentVersionId: { type: "null" },
        bundleLocator: { type: "object" },
        bundleSha256: { type: "string" },
        removalIntent: { type: "null" },
        removalIntentSha256: { type: "null" },
      },
      [COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD]: [
        ["subjectSha256", "bundleSha256"],
      ],
      [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
        {
          operation: "compare",
          left: "/bundleLocator/applicationSha256",
          relation: "equal",
          right: "/bundleSha256",
        },
      ] satisfies readonly LearningContractAssertionV1[],
    },
  },
  {
    if: {
      properties: { action: { const: "update" } },
      required: ["action"],
    },
    then: {
      properties: {
        proposedVersionId: { type: "string" },
        parentVersionId: { type: "string" },
        bundleLocator: { type: "object" },
        bundleSha256: { type: "string" },
        removalIntent: { type: "null" },
        removalIntentSha256: { type: "null" },
      },
      [COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD]: [
        ["subjectSha256", "bundleSha256"],
      ],
      [COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD]: [
        {
          operation: "compare",
          left: "/bundleLocator/applicationSha256",
          relation: "equal",
          right: "/bundleSha256",
        },
      ] satisfies readonly LearningContractAssertionV1[],
    },
  },
  {
    if: {
      properties: { action: { const: "remove" } },
      required: ["action"],
    },
    then: {
      properties: {
        proposedVersionId: { type: "null" },
        parentVersionId: { type: "string" },
        bundleLocator: { type: "null" },
        bundleSha256: { type: "null" },
        removalIntent: { type: "object" },
        removalIntentSha256: { type: "string" },
      },
      [COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD]: [
        ["subjectSha256", "removalIntentSha256"],
      ],
    },
  },
];

const generatedSkillCandidateActionJsonSchema: z.core.JSONSchema.JSONSchema[] =
  [
    {
      if: {
        properties: { action: { const: "add" } },
        required: ["action"],
      },
      then: {
        properties: {
          skillId: { type: "null" },
          parentVersionId: { type: "null" },
          bundle: { type: "object" },
          removalIntent: { type: "null" },
        },
      },
    },
    {
      if: {
        properties: { action: { const: "update" } },
        required: ["action"],
      },
      then: {
        properties: {
          skillId: { type: "string" },
          parentVersionId: { type: "string" },
          bundle: { type: "object" },
          removalIntent: { type: "null" },
        },
      },
    },
    {
      if: {
        properties: { action: { const: "remove" } },
        required: ["action"],
      },
      then: {
        properties: {
          skillId: { type: "string" },
          parentVersionId: { type: "string" },
          bundle: { type: "null" },
          removalIntent: { type: "object", minProperties: 1 },
        },
      },
    },
  ];
// oxlint-enable unicorn/no-thenable

/** Generates JSON Schema while preserving candidate refinement semantics. */
export function toLearningContractJsonSchema(schema: z.ZodType) {
  const generatedJsonSchema = z.toJSONSchema(schema, {
    override: ({ zodSchema, jsonSchema: schemaFragment }) => {
      const assertions = portableAssertionsBySchema.get(zodSchema);
      if (assertions !== undefined) {
        schemaFragment[COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD] = [
          ...assertions,
        ];
      }
      const actionConstraints =
        zodSchema === skillCandidateV1Schema
          ? skillCandidateActionJsonSchema
          : zodSchema === generatedSkillCandidateV1Schema
            ? generatedSkillCandidateActionJsonSchema
            : zodSchema === skillSetProjectionV1Schema
              ? [
                  {
                    if: {
                      properties: { revoked: { const: true } },
                      required: ["revoked"],
                    },
                    // oxlint-disable-next-line unicorn/no-thenable -- `then` is a JSON Schema keyword here.
                    then: {
                      properties: { entries: { maxItems: 0 } },
                    },
                  },
                ]
              : undefined;
      if (actionConstraints) {
        schemaFragment.allOf = [
          ...(schemaFragment.allOf ?? []),
          ...actionConstraints,
        ];
      }
    },
  });

  if (jsonSchemaContainsCustomSemanticsKeyword(generatedJsonSchema)) {
    const portableSchema: Record<string, unknown> = generatedJsonSchema;
    portableSchema.$schema = COPILOTKIT_LEARNING_CONTRACT_META_SCHEMA_URI;
  }
  return generatedJsonSchema;
}

function jsonSchemaContainsCustomSemanticsKeyword(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(jsonSchemaContainsCustomSemanticsKeyword);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (
    Object.hasOwn(value, COPILOTKIT_EQUAL_PROPERTIES_JSON_SCHEMA_KEYWORD) ||
    Object.hasOwn(value, COPILOTKIT_ASSERTIONS_JSON_SCHEMA_KEYWORD)
  ) {
    return true;
  }
  return Object.values(value).some(jsonSchemaContainsCustomSemanticsKeyword);
}

export const learningWorkflowOutputV1Schema = z
  .looseObject({
    schemaVersion: z.literal(1),
    insights: z.array(generatedInsightV1Schema),
    skillCandidates: z.array(generatedSkillCandidateV1Schema),
    coverage: jsonObjectSchema,
    rejections: z.array(jsonObjectSchema),
    usage: jsonObjectSchema,
  })
  .superRefine((output, context) => {
    const insightAliases = new Set<string>();
    for (const [index, insight] of output.insights.entries()) {
      if (insightAliases.has(insight.outputAlias)) {
        context.addIssue({
          code: "custom",
          path: ["insights", index, "outputAlias"],
          message: "Insight output aliases must be unique",
        });
      }
      insightAliases.add(insight.outputAlias);
    }

    const candidateAliases = new Set<string>();
    for (const [
      candidateIndex,
      candidate,
    ] of output.skillCandidates.entries()) {
      if (candidateAliases.has(candidate.outputAlias)) {
        context.addIssue({
          code: "custom",
          path: ["skillCandidates", candidateIndex, "outputAlias"],
          message: "Candidate output aliases must be unique",
        });
      }
      candidateAliases.add(candidate.outputAlias);

      for (const [aliasIndex, alias] of candidate.insightAliases.entries()) {
        if (!insightAliases.has(alias)) {
          context.addIssue({
            code: "custom",
            path: [
              "skillCandidates",
              candidateIndex,
              "insightAliases",
              aliasIndex,
            ],
            message: "Candidate insight aliases must reference an insight",
          });
        }
      }
    }
  });
export type LearningWorkflowOutputV1 = z.infer<
  typeof learningWorkflowOutputV1Schema
>;

/** Complete validated output returned by one deterministic workflow attempt. */
export const learningRunExecutionResultV1Schema = z
  .looseObject({
    outputSha256: sha256Schema,
    chunks: z.array(learningChunkV1Schema).min(1),
    workflowOutput: learningWorkflowOutputV1Schema,
  })
  .superRefine((result, context) => {
    const firstChunk = result.chunks[0];
    if (firstChunk === undefined) return;

    let previousLastSequence: number | undefined;
    for (const [index, chunk] of result.chunks.entries()) {
      if (chunk.learningRunId !== firstChunk.learningRunId) {
        context.addIssue({
          code: "custom",
          path: ["chunks", index, "learningRunId"],
          message: "Execution result chunks must belong to one learning run",
        });
      }
      if (chunk.attemptId !== firstChunk.attemptId) {
        context.addIssue({
          code: "custom",
          path: ["chunks", index, "attemptId"],
          message: "Execution result chunks must belong to one attempt",
        });
      }
      if (chunk.chunkIndex !== index) {
        context.addIssue({
          code: "custom",
          path: ["chunks", index, "chunkIndex"],
          message:
            "Execution result chunk indexes must be contiguous from zero",
        });
      }
      if (
        previousLastSequence !== undefined &&
        chunk.snapshotRange.firstSequence <= previousLastSequence
      ) {
        context.addIssue({
          code: "custom",
          path: ["chunks", index, "snapshotRange", "firstSequence"],
          message:
            "Execution result snapshot ranges must be ordered and non-overlapping",
        });
      }
      previousLastSequence = chunk.snapshotRange.lastSequence;
    }
  });
export type LearningRunExecutionResultV1 = z.infer<
  typeof learningRunExecutionResultV1Schema
>;

/** Minimal pg-boss payload whose worker reloads the frozen durable manifest. */
export const learningRunJobV1Schema = z.looseObject({
  ...workerEnvelopeShape,
  learningRunId: uuidSchema,
  attemptId: uuidSchema,
  fenceGeneration: nonNegativeIntegerSchema,
});
export type LearningRunJobV1 = z.infer<typeof learningRunJobV1Schema>;

const frozenManifestPortableAssertions = [
  {
    operation: "compare",
    left: "/selectedAfterSequence",
    relation: "less-than-or-equal",
    right: "/selectedThroughSequence",
    valueType: "number",
  },
  {
    operation: "unique",
    values: "/snapshotIdsAndHashes/*/snapshotId",
    normalization: { caseFold: true },
  },
  {
    operation: "values-in-range",
    values: "/snapshotIdsAndHashes/*/containerSequence",
    minimum: "/selectedAfterSequence",
    maximum: "/selectedThroughSequence",
    minimumExclusive: true,
    valueType: "number",
  },
  {
    operation: "strictly-increasing",
    values: "/snapshotIdsAndHashes/*/containerSequence",
    valueType: "number",
  },
  {
    operation: "references",
    values: "/selectedAnnotations/*/targetSnapshotId",
    targets: "/snapshotIdsAndHashes/*/snapshotId",
    normalization: { caseFold: true },
  },
] as const satisfies readonly LearningContractAssertionV1[];

registerLearningContractPortableAssertions(runSnapshotV1Schema, [
  {
    operation: "lookup-equal",
    collection: "/sourceEvents/*",
    key: "/eventId",
    reference: "/terminalEventId",
    value: "/type",
    expected: "/terminalType",
  },
  {
    operation: "count",
    values: "/sourceEvents/*/type",
    where: { in: ["RUN_FINISHED", "RUN_ERROR"] },
    exactly: 1,
  },
  {
    operation: "compare",
    left: "/startedAt",
    relation: "less-than-or-equal",
    right: "/terminalAt",
    valueType: "date-time",
  },
  {
    operation: "compare",
    left: "/terminalAt",
    relation: "less-than-or-equal",
    right: "/capturedAt",
    valueType: "date-time",
  },
]);
registerLearningContractPortableAssertions(
  learningRunFrozenManifestV1Schema,
  frozenManifestPortableAssertions,
);
registerLearningContractPortableAssertions(
  learningRunV1Schema,
  frozenManifestPortableAssertions,
);
registerLearningContractPortableAssertions(learningChunkV1Schema, [
  {
    operation: "compare",
    left: "/snapshotRange/firstSequence",
    relation: "less-than-or-equal",
    right: "/snapshotRange/lastSequence",
    valueType: "number",
  },
]);
registerLearningContractPortableAssertions(skillArtifactManifestV1Schema, [
  {
    operation: "unique",
    values: "/files/*/path",
    normalization: { unicode: "NFC", caseFold: true },
  },
  {
    operation: "count",
    values: "/files/*/path",
    where: { equals: "SKILL.md" },
    minimum: 1,
  },
]);
registerLearningContractPortableAssertions(skillBundleV1Schema, [
  {
    operation: "compare",
    left: "/manifest/bundleSha256",
    relation: "equal",
    right: "/locator/applicationSha256",
  },
  {
    operation: "compare",
    left: "/manifest/bundleByteLength",
    relation: "equal",
    right: "/locator/byteLength",
  },
]);
registerLearningContractPortableAssertions(skillSetProjectionEntryV1Schema, [
  {
    operation: "compare",
    left: "/bundleSha256",
    relation: "equal",
    right: "/bundleLocator/applicationSha256",
  },
  {
    operation: "compare",
    left: "/bundleByteLength",
    relation: "equal",
    right: "/bundleLocator/byteLength",
  },
  {
    operation: "compare",
    left: "/manifest/bundleSha256",
    relation: "equal",
    right: "/bundleSha256",
  },
  {
    operation: "compare",
    left: "/manifest/manifestSha256",
    relation: "equal",
    right: "/manifestSha256",
  },
  {
    operation: "compare",
    left: "/manifest/bundleByteLength",
    relation: "equal",
    right: "/bundleByteLength",
  },
]);
registerLearningContractPortableAssertions(skillSetProjectionV1Schema, [
  {
    operation: "contiguous",
    values: "/entries/*/position",
    start: 0,
  },
  {
    operation: "unique",
    values: "/entries/*/skillId",
    normalization: { caseFold: true },
  },
]);
registerLearningContractPortableAssertions(learningWorkflowInputV1Schema, [
  {
    operation: "unique",
    values: "/threads/*/threadId",
  },
  {
    operation: "unique",
    values: "/threads/*/snapshotId",
    normalization: { caseFold: true },
  },
  {
    operation: "unique",
    values: "/availableSkills/*/alias",
  },
  {
    operation: "references",
    values: "/selectedAnnotations/*/targetSnapshotId",
    targets: "/threads/*/snapshotId",
    normalization: { caseFold: true },
  },
  {
    operation: "lookup-references",
    sources: "/selectedAnnotations/*",
    reference: "/targetSnapshotId",
    values: "/targetEvidenceLocator/messageIds/*",
    collection: "/threads/*",
    key: "/snapshotId",
    targets: "/messages/*/messageId",
    keyNormalization: { caseFold: true },
  },
  {
    operation: "lookup-references",
    sources: "/selectedAnnotations/*",
    reference: "/targetSnapshotId",
    values: "/targetEvidenceLocator/eventIds/*",
    collection: "/threads/*",
    key: "/snapshotId",
    targets: "/messages/*/eventIds/*",
    keyNormalization: { caseFold: true },
  },
]);
registerLearningContractPortableAssertions(generatedSkillBundleV1Schema, [
  {
    operation: "unique",
    values: "/files/*/path",
    normalization: { unicode: "NFKC", caseFold: true },
  },
  {
    operation: "count",
    values: "/files/*/path",
    where: { equals: "SKILL.md" },
    exactly: 1,
  },
]);
registerLearningContractPortableAssertions(learningWorkflowOutputV1Schema, [
  {
    operation: "unique",
    values: "/insights/*/outputAlias",
  },
  {
    operation: "unique",
    values: "/skillCandidates/*/outputAlias",
  },
  {
    operation: "references",
    values: "/skillCandidates/*/insightAliases/*",
    targets: "/insights/*/outputAlias",
  },
]);
registerLearningContractPortableAssertions(learningRunExecutionResultV1Schema, [
  {
    operation: "unique",
    values: "/chunks/*/learningRunId",
  },
  {
    operation: "unique",
    values: "/chunks/*/attemptId",
  },
  {
    operation: "contiguous",
    values: "/chunks/*/chunkIndex",
    start: 0,
  },
  {
    operation: "ordered-ranges",
    ranges: "/chunks/*",
    first: "/snapshotRange/firstSequence",
    last: "/snapshotRange/lastSequence",
    valueType: "number",
  },
]);

/** Named language-neutral JSON Schemas generated from the canonical Zod 4 source. */
export const learningContractJsonSchemas = {
  BlobLocatorV1: toLearningContractJsonSchema(blobLocatorV1Schema),
  CandidateGateResultV1: toLearningContractJsonSchema(
    candidateGateResultV1Schema,
  ),
  EvidenceRefV1: toLearningContractJsonSchema(evidenceRefV1Schema),
  InsightV1: toLearningContractJsonSchema(insightV1Schema),
  LearningChunkV1: toLearningContractJsonSchema(learningChunkV1Schema),
  LearningContainerV1: toLearningContractJsonSchema(learningContainerV1Schema),
  LearningRunV1: toLearningContractJsonSchema(learningRunV1Schema),
  LearningRunExecutionResultV1: toLearningContractJsonSchema(
    learningRunExecutionResultV1Schema,
  ),
  LearningRunJobV1: toLearningContractJsonSchema(learningRunJobV1Schema),
  LearningWorkflowInputV1: toLearningContractJsonSchema(
    learningWorkflowInputV1Schema,
  ),
  LearningWorkflowOutputV1: toLearningContractJsonSchema(
    learningWorkflowOutputV1Schema,
  ),
  NormalizedMessageV1: toLearningContractJsonSchema(normalizedMessageV1Schema),
  RunSnapshotV1: toLearningContractJsonSchema(runSnapshotV1Schema),
  SelectedHumanAnnotationV1: toLearningContractJsonSchema(
    selectedHumanAnnotationV1Schema,
  ),
  SkillArtifactManifestV1: toLearningContractJsonSchema(
    skillArtifactManifestV1Schema,
  ),
  SkillCandidateV1: toLearningContractJsonSchema(skillCandidateV1Schema),
  SkillSetProjectionV1: toLearningContractJsonSchema(
    skillSetProjectionV1Schema,
  ),
} as const;
