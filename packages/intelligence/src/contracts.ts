import { z } from "zod/v4";

const nonEmptyStringSchema = z.string().min(1);
const canonicalBase64Schema = z
  .string()
  .min(1)
  .regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?(?![\s\S])/u,
    "Expected canonical RFC 4648 base64",
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
    const terminalEventCount = snapshot.sourceEvents.filter(
      ({ eventId }) => eventId === snapshot.terminalEventId,
    ).length;
    if (terminalEventCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["sourceEvents"],
        message: "Source events must contain exactly one terminal event",
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

/** Durable learning run and its immutable frozen manifest. */
export const learningRunV1Schema = z
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
    status: learningRunStatusV1Schema,
    createdAt: timestampSchema,
    startedAt: nullableTimestampSchema,
    completedAt: nullableTimestampSchema,
  })
  .superRefine((run, context) => {
    if (run.selectedAfterSequence > run.selectedThroughSequence) {
      context.addIssue({
        code: "custom",
        path: ["selectedThroughSequence"],
        message: "Selected-through sequence cannot precede selected-after",
      });
    }

    const snapshotIds = new Set<string>();
    let previousSequence: number | undefined;
    for (const [index, snapshot] of run.snapshotIdsAndHashes.entries()) {
      if (snapshotIds.has(snapshot.snapshotId)) {
        context.addIssue({
          code: "custom",
          path: ["snapshotIdsAndHashes", index, "snapshotId"],
          message: "Frozen snapshot identities must be unique",
        });
      }
      snapshotIds.add(snapshot.snapshotId);

      if (
        snapshot.containerSequence <= run.selectedAfterSequence ||
        snapshot.containerSequence > run.selectedThroughSequence
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
  });
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
  path: nonEmptyStringSchema,
  role: nonEmptyStringSchema,
  mediaType: nonEmptyStringSchema,
  byteLength: nonNegativeIntegerSchema,
  rawSha256: sha256Schema,
});
export type SkillArtifactFileV1 = z.infer<typeof skillArtifactFileV1Schema>;

export const skillArtifactManifestV1Schema = z.looseObject({
  manifestVersion: z.literal(1),
  agentSkillsProfile: nonEmptyStringSchema,
  files: z.array(skillArtifactFileV1Schema).min(1),
  manifestSha256: sha256Schema,
  bundleSha256: sha256Schema,
  bundleByteLength: positiveIntegerSchema,
  provenance: jsonObjectSchema,
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

export const skillBundleV1Schema = z.looseObject({
  schemaVersion: z.literal(1),
  manifest: skillArtifactManifestV1Schema,
  locator: blobLocatorV1Schema,
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

export const skillSetProjectionEntryV1Schema = z.looseObject({
  skillId: uuidSchema,
  versionId: uuidSchema,
  position: nonNegativeIntegerSchema,
  name: nonEmptyStringSchema,
  description: z.string().nullable(),
  bundleLocator: blobLocatorV1Schema,
  bundleSha256: sha256Schema,
  manifestSha256: sha256Schema,
  bundleByteLength: positiveIntegerSchema,
  approvalMethod: z.enum(["manual", "automatic"]),
});
export type SkillSetProjectionEntryV1 = z.infer<
  typeof skillSetProjectionEntryV1Schema
>;

/** Complete ordered runtime projection; an empty projection is valid. */
export const skillSetProjectionV1Schema = z.looseObject({
  schemaVersion: z.literal(1),
  learningContainerId: uuidSchema,
  registryRevision: nonEmptyStringSchema,
  skillSetHash: sha256Schema,
  etag: nonEmptyStringSchema,
  entries: z.array(skillSetProjectionEntryV1Schema),
  publishedAt: timestampSchema,
  revoked: z.boolean(),
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

      if (snapshots.has(thread.snapshotId)) {
        context.addIssue({
          code: "custom",
          path: ["threads", index, "snapshotId"],
          message: "Workflow snapshot IDs must be unique",
        });
      } else {
        snapshots.set(thread.snapshotId, thread);
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
      const thread = snapshots.get(annotation.targetSnapshotId);
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

const generatedSkillBundleV1Schema = z.looseObject({
  rootDirectoryName: nonEmptyStringSchema,
  files: z
    .array(
      z.looseObject({
        path: nonEmptyStringSchema,
        contentBase64: canonicalBase64Schema,
      }),
    )
    .min(1),
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
export const learningRunExecutionResultV1Schema = z.looseObject({
  outputSha256: sha256Schema,
  chunks: z.array(learningChunkV1Schema),
  workflowOutput: learningWorkflowOutputV1Schema,
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

/** Named language-neutral JSON Schemas generated from the canonical Zod 4 source. */
export const learningContractJsonSchemas = {
  BlobLocatorV1: z.toJSONSchema(blobLocatorV1Schema),
  CandidateGateResultV1: z.toJSONSchema(candidateGateResultV1Schema),
  EvidenceRefV1: z.toJSONSchema(evidenceRefV1Schema),
  InsightV1: z.toJSONSchema(insightV1Schema),
  LearningChunkV1: z.toJSONSchema(learningChunkV1Schema),
  LearningContainerV1: z.toJSONSchema(learningContainerV1Schema),
  LearningRunV1: z.toJSONSchema(learningRunV1Schema),
  LearningRunExecutionResultV1: z.toJSONSchema(
    learningRunExecutionResultV1Schema,
  ),
  LearningRunJobV1: z.toJSONSchema(learningRunJobV1Schema),
  LearningWorkflowInputV1: z.toJSONSchema(learningWorkflowInputV1Schema),
  LearningWorkflowOutputV1: z.toJSONSchema(learningWorkflowOutputV1Schema),
  NormalizedMessageV1: z.toJSONSchema(normalizedMessageV1Schema),
  RunSnapshotV1: z.toJSONSchema(runSnapshotV1Schema),
  SelectedHumanAnnotationV1: z.toJSONSchema(selectedHumanAnnotationV1Schema),
  SkillArtifactManifestV1: z.toJSONSchema(skillArtifactManifestV1Schema),
  SkillCandidateV1: z.toJSONSchema(skillCandidateV1Schema),
  SkillSetProjectionV1: z.toJSONSchema(skillSetProjectionV1Schema),
} as const;
