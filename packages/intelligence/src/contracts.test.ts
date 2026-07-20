import { describe, expect, test } from "vitest";
import {
  blobLocatorV1Schema,
  candidateGateResultV1Schema,
  frozenAvailableSkillV1Schema,
  generatedSkillCandidateV1Schema,
  insightV1Schema,
  learningChunkV1Schema,
  learningContainerIdSchema,
  learningContainerV1Schema,
  learningContractJsonSchemas,
  learningRunV1Schema,
  learningWorkflowInputV1Schema,
  learningWorkflowOutputV1Schema,
  runSnapshotV1Schema,
  skillCandidateV1Schema,
  skillSetProjectionV1Schema,
  threadAssignmentPatchV1Schema,
} from "./contracts.js";

const UUIDS = {
  container: "11111111-1111-4111-8111-111111111111",
  snapshot: "22222222-2222-4222-8222-222222222222",
  snapshotSecond: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  attempt: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  insight: "33333333-3333-4333-8333-333333333333",
  run: "44444444-4444-4444-8444-444444444444",
  candidate: "55555555-5555-4555-8555-555555555555",
  candidateRevision: "66666666-6666-4666-8666-666666666666",
  skill: "77777777-7777-4777-8777-777777777777",
  version: "88888888-8888-4888-8888-888888888888",
  gate: "99999999-9999-4999-8999-999999999999",
} as const;

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const NOW = "2026-07-16T18:00:00.000Z";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const learningContainer = {
  schemaVersion: 1,
  id: UUIDS.container,
  organizationId: "org_1",
  projectId: "42",
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
} as const;

const snapshot = {
  schemaVersion: 1,
  snapshotId: UUIDS.snapshot,
  organizationId: "org_1",
  projectId: "42",
  learningContainerId: UUIDS.container,
  threadId: "thread_1",
  agentRunId: "9007199254740993",
  externalRunId: "run_external_1",
  terminalEventId: "event_terminal",
  terminalType: "RUN_FINISHED",
  terminalStatus: null,
  startedAt: NOW,
  terminalAt: NOW,
  capturedAt: NOW,
  assignmentRevision: 2,
  sourceEvents: [
    {
      eventId: "event_1",
      sequence: 1,
      type: "TEXT_MESSAGE_END",
      sha256: SHA_A,
    },
    {
      eventId: "event_terminal",
      sequence: 2,
      type: "RUN_FINISHED",
      sha256: SHA_B,
    },
  ],
  messages: [
    {
      messageId: "message_1",
      role: "assistant",
      content: "done",
      toolCalls: [{ id: "call_1", name: "search", argsText: "{}" }],
      toolResults: [
        { toolCallId: "call_1", status: "unknown", output: { hits: 2 } },
      ],
      eventIds: ["event_1"],
      timestamp: NOW,
    },
  ],
  stateChanges: [],
  annotations: [],
  attachments: [],
  normalizerVersion: "normalizer:v1",
  sanitizerVersion: "sanitizer:v1",
  contentSha256: SHA_A,
  byteLength: 100,
  tokenEstimate: 25,
  containerSequence: 1,
} as const;

const frozenAvailableSkill = {
  skillId: UUIDS.skill,
  versionId: UUIDS.version,
  alias: "idempotent-retries",
  name: "Idempotent retries",
  description: null,
  bundle: {
    schemaVersion: 1,
    manifest: {
      manifestVersion: 1,
      agentSkillsProfile: "agentskills:v1",
      files: [
        {
          path: "SKILL.md",
          role: "instructions",
          mediaType: "text/markdown",
          byteLength: 12,
          rawSha256: SHA_A,
        },
      ],
      manifestSha256: SHA_A,
      bundleSha256: SHA_B,
      bundleByteLength: 12,
      provenance: {},
    },
    locator: {
      schemaVersion: 1,
      backendId: "primary",
      provider: "awsS3",
      resource: "skill-bundles",
      key: "objects/aa/bundle.zip",
      providerVersion: null,
      etag: null,
      applicationSha256: SHA_B,
      providerChecksum: null,
      byteLength: 12,
      contentType: "application/zip",
    },
  },
  registryState: "published",
} as const;

const workflowInput = {
  schemaVersion: 1,
  threads: [
    {
      snapshotId: UUIDS.snapshot,
      snapshotSha256: SHA_A,
      threadId: "thread_1",
      externalRunId: "run_external_1",
      messages: snapshot.messages,
    },
    {
      snapshotId: UUIDS.snapshotSecond,
      snapshotSha256: SHA_B,
      threadId: "thread_2",
      externalRunId: "run_external_2",
      messages: [
        {
          ...snapshot.messages[0],
          messageId: "message_2",
          eventIds: ["event_2"],
        },
      ],
    },
  ],
  selectedAnnotations: [
    {
      schemaVersion: 1,
      annotationId: UUIDS.insight,
      targetSnapshotId: UUIDS.snapshot,
      targetEvidenceLocator: {
        messageIds: ["message_1"],
        eventIds: ["event_1"],
      },
      text: "Prefer idempotent retries.",
      contentSha256: SHA_B,
      annotationRevision: 0,
      authoredAt: NOW,
      capturedAt: NOW,
    },
  ],
  availableSkills: [frozenAvailableSkill],
  promptContext: null,
  limits: {},
} as const;

const generatedInsight = {
  outputAlias: "insight_1",
  kind: "workflow",
  statement: "Retries repeat after a completed action.",
  impact: "Repeated actions can affect a user twice.",
  confidence: 0.9,
  skillEligible: true,
  evidenceRefs: [
    {
      evidenceType: "run_snapshot",
      snapshotId: UUIDS.snapshot,
      snapshotSha256: SHA_A,
      threadId: "thread_1",
      externalRunId: "run_external_1",
      messageIds: ["message_1"],
      eventIds: ["event_1"],
      excerpt: null,
      excerptSha256: null,
      truncated: false,
    },
  ],
} as const;

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
  evidenceRefs: [],
  reason: "Avoid duplicate actions.",
  risk: "low",
} as const;

const workflowOutput = {
  schemaVersion: 1,
  insights: [generatedInsight],
  skillCandidates: [generatedCandidate],
  coverage: {},
  rejections: [],
  usage: {},
} as const;

const learningRun = {
  learningRunId: UUIDS.run,
  organizationId: "org_1",
  projectId: "42",
  learningContainerId: UUIDS.container,
  trigger: "manual",
  idempotencyKey: "manual:run_1",
  selectedAfterSequence: 3,
  selectedThroughSequence: 8,
  snapshotIdsAndHashes: [
    {
      snapshotId: UUIDS.snapshot,
      contentSha256: SHA_A,
      containerSequence: 4,
    },
    {
      snapshotId: UUIDS.snapshotSecond,
      contentSha256: SHA_B,
      containerSequence: 8,
    },
  ],
  selectedAnnotations: [],
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
} as const;

const learningChunk = {
  learningRunId: UUIDS.run,
  attemptId: UUIDS.attempt,
  chunkIndex: 0,
  snapshotRange: {
    firstSnapshotId: UUIDS.snapshot,
    lastSnapshotId: UUIDS.snapshotSecond,
    firstSequence: 4,
    lastSequence: 8,
  },
  inputSha256: SHA_A,
  outputSha256: null,
  status: "planned",
  privatePayloadRef: {},
  createdAt: NOW,
  updatedAt: NOW,
} as const;

describe("parent V1 contract schemas", () => {
  test("accepts a workflow output with unique aliases and resolved insight references", () => {
    expect(learningWorkflowOutputV1Schema.parse(workflowOutput)).toEqual(
      workflowOutput,
    );
  });

  test.each([
    { name: "add", candidate: generatedCandidate },
    {
      name: "update",
      candidate: {
        ...generatedCandidate,
        action: "update",
        skillId: UUIDS.skill,
        parentVersionId: UUIDS.version,
      },
    },
    {
      name: "remove",
      candidate: {
        ...generatedCandidate,
        action: "remove",
        skillId: UUIDS.skill,
        parentVersionId: UUIDS.version,
        bundle: null,
        removalIntent: { reasonCode: "unsafe_behavior" },
      },
    },
  ])(
    "accepts a generated $name candidate with target identity coherence",
    ({ candidate }) => {
      expect(generatedSkillCandidateV1Schema.safeParse(candidate).success).toBe(
        true,
      );
    },
  );

  test.each([
    {
      name: "add with an existing skill ID",
      candidate: { ...generatedCandidate, skillId: UUIDS.skill },
    },
    {
      name: "add with an existing parent version ID",
      candidate: { ...generatedCandidate, parentVersionId: UUIDS.version },
    },
    {
      name: "update without a skill ID",
      candidate: {
        ...generatedCandidate,
        action: "update",
        parentVersionId: UUIDS.version,
      },
    },
    {
      name: "update without a parent version ID",
      candidate: {
        ...generatedCandidate,
        action: "update",
        skillId: UUIDS.skill,
      },
    },
    {
      name: "remove without a skill ID",
      candidate: {
        ...generatedCandidate,
        action: "remove",
        parentVersionId: UUIDS.version,
        bundle: null,
        removalIntent: { reasonCode: "unsafe_behavior" },
      },
    },
    {
      name: "remove without a parent version ID",
      candidate: {
        ...generatedCandidate,
        action: "remove",
        skillId: UUIDS.skill,
        bundle: null,
        removalIntent: { reasonCode: "unsafe_behavior" },
      },
    },
    {
      name: "remove with an empty removal intent",
      candidate: {
        ...generatedCandidate,
        action: "remove",
        skillId: UUIDS.skill,
        parentVersionId: UUIDS.version,
        bundle: null,
        removalIntent: {},
      },
    },
  ])("rejects a generated $name", ({ candidate }) => {
    expect(generatedSkillCandidateV1Schema.safeParse(candidate).success).toBe(
      false,
    );
  });

  test.each([
    {
      name: "duplicate insight output aliases",
      value: {
        ...workflowOutput,
        insights: [generatedInsight, generatedInsight],
      },
    },
    {
      name: "duplicate candidate output aliases",
      value: {
        ...workflowOutput,
        skillCandidates: [generatedCandidate, generatedCandidate],
      },
    },
    {
      name: "an unresolved candidate insight alias",
      value: {
        ...workflowOutput,
        skillCandidates: [
          { ...generatedCandidate, insightAliases: ["missing_insight"] },
        ],
      },
    },
  ])("rejects a workflow output alias graph with $name", ({ value }) => {
    expect(learningWorkflowOutputV1Schema.safeParse(value).success).toBe(false);
  });

  test("accepts a workflow input with unique identities and scoped annotation evidence", () => {
    expect(learningWorkflowInputV1Schema.parse(workflowInput)).toEqual(
      workflowInput,
    );
  });

  test.each([
    {
      name: "thread IDs",
      value: {
        ...workflowInput,
        threads: [
          workflowInput.threads[0],
          { ...workflowInput.threads[1], threadId: "thread_1" },
        ],
      },
    },
    {
      name: "snapshot IDs",
      value: {
        ...workflowInput,
        threads: [
          workflowInput.threads[0],
          { ...workflowInput.threads[1], snapshotId: UUIDS.snapshot },
        ],
      },
    },
    {
      name: "available-skill aliases",
      value: {
        ...workflowInput,
        availableSkills: [
          frozenAvailableSkill,
          {
            ...frozenAvailableSkill,
            skillId: UUIDS.candidate,
            versionId: UUIDS.candidateRevision,
          },
        ],
      },
    },
  ])("rejects duplicate $name in a workflow input", ({ value }) => {
    expect(learningWorkflowInputV1Schema.safeParse(value).success).toBe(false);
  });

  test.each([
    {
      name: "snapshot",
      targetSnapshotId: UUIDS.container,
      targetEvidenceLocator: null,
    },
    {
      name: "message in the target thread",
      targetSnapshotId: UUIDS.snapshotSecond,
      targetEvidenceLocator: {
        messageIds: ["message_1"],
        eventIds: [],
      },
    },
    {
      name: "event in the target thread",
      targetSnapshotId: UUIDS.snapshotSecond,
      targetEvidenceLocator: {
        messageIds: [],
        eventIds: ["event_1"],
      },
    },
  ])("rejects an annotation referencing an absent $name", (annotation) => {
    expect(
      learningWorkflowInputV1Schema.safeParse({
        ...workflowInput,
        selectedAnnotations: [
          { ...workflowInput.selectedAnnotations[0], ...annotation },
        ],
      }).success,
    ).toBe(false);
  });

  test("accepts ordinary learning container UUIDs and explicit null but rejects the nil UUID", () => {
    expect(learningContainerIdSchema.parse(UUIDS.container)).toBe(
      UUIDS.container,
    );
    expect(learningContainerIdSchema.parse(null)).toBeNull();
    expect(learningContainerIdSchema.safeParse(NIL_UUID).success).toBe(false);
    expect(learningContainerIdSchema.safeParse("project").success).toBe(false);
  });

  test("parses a complete LearningContainerV1 without inventing a default assignment", () => {
    expect(learningContainerV1Schema.parse(learningContainer)).toEqual(
      learningContainer,
    );
    expect(
      threadAssignmentPatchV1Schema.parse({
        learningContainerId: null,
        expectedLearningContainerId: null,
      }),
    ).toEqual({
      learningContainerId: null,
      expectedLearningContainerId: null,
    });
  });

  test("rejects invalid assignment identifiers and missing compare values", () => {
    expect(
      threadAssignmentPatchV1Schema.safeParse({
        learningContainerId: "project",
      }).success,
    ).toBe(false);
    expect(
      threadAssignmentPatchV1Schema.safeParse({
        learningContainerId: UUIDS.container,
      }).success,
    ).toBe(false);
  });

  test("preserves plural tool calls/results without inventing optional names", () => {
    const parsed = runSnapshotV1Schema.parse(snapshot);

    expect(parsed.messages[0]?.toolCalls).toHaveLength(1);
    expect(parsed.messages[0]?.toolResults[0]).toEqual({
      toolCallId: "call_1",
      status: "unknown",
      output: { hits: 2 },
    });
  });

  test("rejects snapshots whose hashes or integer planning bounds are invalid", () => {
    expect(
      runSnapshotV1Schema.safeParse({ ...snapshot, contentSha256: "short" })
        .success,
    ).toBe(false);
    expect(
      runSnapshotV1Schema.safeParse({ ...snapshot, byteLength: -1 }).success,
    ).toBe(false);
  });

  test("requires exactly one source event matching the terminal event ID", () => {
    expect(runSnapshotV1Schema.parse(snapshot)).toEqual(snapshot);
    expect(
      runSnapshotV1Schema.safeParse({
        ...snapshot,
        sourceEvents: snapshot.sourceEvents.filter(
          ({ eventId }) => eventId !== snapshot.terminalEventId,
        ),
      }).success,
    ).toBe(false);
    expect(
      runSnapshotV1Schema.safeParse({
        ...snapshot,
        sourceEvents: [...snapshot.sourceEvents, snapshot.sourceEvents[1]],
      }).success,
    ).toBe(false);
  });

  test("requires snapshot timestamps to follow capture order", () => {
    expect(
      runSnapshotV1Schema.safeParse({
        ...snapshot,
        startedAt: "2026-07-16T17:00:00.000Z",
        terminalAt: "2026-07-16T18:00:00.000Z",
        capturedAt: "2026-07-16T19:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(runSnapshotV1Schema.safeParse(snapshot).success).toBe(true);
    expect(
      runSnapshotV1Schema.safeParse({
        ...snapshot,
        startedAt: "2026-07-16T19:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      runSnapshotV1Schema.safeParse({
        ...snapshot,
        capturedAt: "2026-07-16T17:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  test("accepts ordered frozen snapshot identities inside the selected interval", () => {
    expect(learningRunV1Schema.parse(learningRun)).toEqual(learningRun);
    expect(
      learningRunV1Schema.safeParse({
        ...learningRun,
        selectedAfterSequence: 8,
        snapshotIdsAndHashes: [],
      }).success,
    ).toBe(true);
  });

  test("rejects inverted frozen selection intervals", () => {
    expect(
      learningRunV1Schema.safeParse({
        ...learningRun,
        selectedAfterSequence: 9,
      }).success,
    ).toBe(false);
  });

  test("rejects snapshot identities outside the selected interval", () => {
    expect(
      learningRunV1Schema.safeParse({
        ...learningRun,
        snapshotIdsAndHashes: [
          { ...learningRun.snapshotIdsAndHashes[0], containerSequence: 3 },
        ],
      }).success,
    ).toBe(false);
    expect(
      learningRunV1Schema.safeParse({
        ...learningRun,
        snapshotIdsAndHashes: [
          { ...learningRun.snapshotIdsAndHashes[0], containerSequence: 9 },
        ],
      }).success,
    ).toBe(false);
  });

  test("rejects duplicate frozen snapshot identities", () => {
    expect(
      learningRunV1Schema.safeParse({
        ...learningRun,
        snapshotIdsAndHashes: [
          learningRun.snapshotIdsAndHashes[0],
          {
            ...learningRun.snapshotIdsAndHashes[1],
            snapshotId: UUIDS.snapshot,
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("requires frozen snapshot identities in strictly increasing sequence order", () => {
    expect(
      learningRunV1Schema.safeParse({
        ...learningRun,
        snapshotIdsAndHashes: [
          learningRun.snapshotIdsAndHashes[1],
          learningRun.snapshotIdsAndHashes[0],
        ],
      }).success,
    ).toBe(false);
    expect(
      learningRunV1Schema.safeParse({
        ...learningRun,
        snapshotIdsAndHashes: [
          learningRun.snapshotIdsAndHashes[0],
          {
            ...learningRun.snapshotIdsAndHashes[1],
            containerSequence: 4,
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("requires learning chunk snapshot ranges in sequence order", () => {
    expect(learningChunkV1Schema.parse(learningChunk)).toEqual(learningChunk);
    expect(
      learningChunkV1Schema.safeParse({
        ...learningChunk,
        snapshotRange: {
          ...learningChunk.snapshotRange,
          firstSequence: 9,
        },
      }).success,
    ).toBe(false);
  });

  test("requires immutable insights to have finite confidence and evidence", () => {
    const insight = {
      schemaVersion: 1,
      id: UUIDS.insight,
      organizationId: "org_1",
      projectId: "42",
      learningContainerId: UUIDS.container,
      learningRunId: UUIDS.run,
      workflowOutputAlias: "insight_1",
      kind: "agent_behavior",
      statement: "The agent retries a completed action.",
      impact: "The duplicate action can charge the user twice.",
      confidence: 0.9,
      skillEligible: true,
      evidenceRefs: [
        {
          evidenceType: "run_snapshot",
          snapshotId: UUIDS.snapshot,
          snapshotSha256: SHA_A,
          threadId: "thread_1",
          externalRunId: "run_external_1",
          messageIds: ["message_1"],
          eventIds: ["event_1"],
          excerpt: null,
          excerptSha256: null,
          truncated: false,
        },
      ],
      createdAt: NOW,
    } as const;

    expect(insightV1Schema.parse(insight)).toEqual(insight);
    expect(
      insightV1Schema.safeParse({ ...insight, confidence: Number.NaN }).success,
    ).toBe(false);
    expect(
      insightV1Schema.safeParse({ ...insight, confidence: 1.01 }).success,
    ).toBe(false);
    expect(
      insightV1Schema.safeParse({ ...insight, evidenceRefs: [] }).success,
    ).toBe(false);
  });

  test("enforces bundle subjects for add/update and removal intents for remove", () => {
    const base = {
      candidateId: UUIDS.candidate,
      candidateRevisionId: UUIDS.candidateRevision,
      organizationId: "org_1",
      projectId: "42",
      learningContainerId: UUIDS.container,
      learningRunId: UUIDS.run,
      skillId: UUIDS.skill,
      insightIds: [UUIDS.insight],
      evidenceRefs: [],
      reason: "Teach an idempotent retry guard.",
      risk: "low",
      approvalModeSnapshot: "manual",
      evaluatorProfileRef: "evaluator:v1",
      status: "pending_review",
      createdByType: "learning",
      createdAt: NOW,
    } as const;
    const bundleLocator = {
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
    } as const;

    const addCandidate = {
      ...base,
      action: "add",
      proposedVersionId: UUIDS.version,
      parentVersionId: null,
      bundleLocator,
      bundleSha256: SHA_A,
      removalIntent: null,
      removalIntentSha256: null,
      subjectSha256: SHA_A,
    } as const;
    const updateCandidate = {
      ...addCandidate,
      action: "update",
      parentVersionId: UUIDS.version,
    } as const;

    expect(skillCandidateV1Schema.safeParse(addCandidate).success).toBe(true);
    expect(skillCandidateV1Schema.safeParse(updateCandidate).success).toBe(
      true,
    );
    for (const candidate of [addCandidate, updateCandidate]) {
      expect(
        skillCandidateV1Schema.safeParse({
          ...candidate,
          removalIntent: { reasonCode: "unsafe_behavior" },
        }).success,
      ).toBe(false);
      expect(
        skillCandidateV1Schema.safeParse({
          ...candidate,
          removalIntentSha256: SHA_B,
        }).success,
      ).toBe(false);
    }
    expect(
      skillCandidateV1Schema.safeParse({
        ...base,
        action: "add",
        proposedVersionId: UUIDS.version,
        parentVersionId: null,
        bundleLocator: null,
        bundleSha256: null,
        removalIntent: null,
        removalIntentSha256: null,
        subjectSha256: SHA_A,
      }).success,
    ).toBe(false);
    expect(
      skillCandidateV1Schema.safeParse({
        ...base,
        action: "remove",
        proposedVersionId: null,
        parentVersionId: UUIDS.version,
        bundleLocator: null,
        bundleSha256: null,
        removalIntent: { reasonCode: "unsafe_behavior" },
        removalIntentSha256: SHA_B,
        subjectSha256: SHA_B,
      }).success,
    ).toBe(true);
  });

  test("binds every gate result to the exact candidate subject hash", () => {
    const gate = {
      gateResultId: UUIDS.gate,
      candidateRevisionId: UUIDS.candidateRevision,
      subjectSha256: SHA_A,
      gate: "behavioral_evaluation",
      profileVersion: "eval:v1",
      fixtureVersion: "fixture:v1",
      baselineVersion: null,
      status: "passed",
      reasonCode: "improved",
      detailsRef: null,
      evaluatedAt: NOW,
    } as const;

    expect(candidateGateResultV1Schema.parse(gate)).toEqual(gate);
    expect(
      candidateGateResultV1Schema.safeParse({ ...gate, subjectSha256: "" })
        .success,
    ).toBe(false);
  });

  test("accepts an empty complete skill projection and rejects partial entries", () => {
    const projection = {
      schemaVersion: 1,
      learningContainerId: UUIDS.container,
      registryRevision: "0",
      skillSetHash: SHA_A,
      etag: '"registry-0"',
      entries: [],
      publishedAt: NOW,
      revoked: true,
    } as const;

    expect(skillSetProjectionV1Schema.parse(projection)).toEqual(projection);
    expect(
      skillSetProjectionV1Schema.safeParse({
        ...projection,
        entries: [{ skillId: UUIDS.skill }],
      }).success,
    ).toBe(false);
  });

  test("preserves a null projection description when freezing an available skill", () => {
    const bundleLocator = {
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
    } as const;
    const projectionEntry = {
      skillId: UUIDS.skill,
      versionId: UUIDS.version,
      position: 0,
      name: "Idempotent retries",
      description: null,
      bundleLocator,
      bundleSha256: SHA_B,
      manifestSha256: SHA_A,
      bundleByteLength: 12,
      approvalMethod: "manual",
    } as const;
    const parsedProjectionEntry = skillSetProjectionV1Schema.parse({
      schemaVersion: 1,
      learningContainerId: UUIDS.container,
      registryRevision: "revision_1",
      skillSetHash: SHA_A,
      etag: '"registry-1"',
      entries: [projectionEntry],
      publishedAt: NOW,
      revoked: false,
    }).entries[0]!;

    const frozen = frozenAvailableSkillV1Schema.parse({
      skillId: parsedProjectionEntry.skillId,
      versionId: parsedProjectionEntry.versionId,
      alias: "idempotent-retries",
      name: parsedProjectionEntry.name,
      description: parsedProjectionEntry.description,
      bundle: {
        schemaVersion: 1,
        manifest: {
          manifestVersion: 1,
          agentSkillsProfile: "agentskills:v1",
          files: [
            {
              path: "SKILL.md",
              role: "instructions",
              mediaType: "text/markdown",
              byteLength: 12,
              rawSha256: SHA_A,
            },
          ],
          manifestSha256: SHA_A,
          bundleSha256: SHA_B,
          bundleByteLength: 12,
          provenance: {},
        },
        locator: parsedProjectionEntry.bundleLocator,
      },
      registryState: "published",
    });

    expect(frozen.description).toBeNull();
  });

  test("supports only the four normative object-storage providers", () => {
    const locator = {
      schemaVersion: 1,
      backendId: "primary",
      provider: "googleCloudStorage",
      resource: "skill-bundles",
      key: "objects/aa/bundle.zip",
      providerVersion: null,
      etag: null,
      applicationSha256: SHA_A,
      providerChecksum: null,
      byteLength: 12,
      contentType: "application/zip",
    } as const;

    expect(blobLocatorV1Schema.parse(locator)).toEqual(locator);
    expect(
      blobLocatorV1Schema.safeParse({ ...locator, provider: "filesystem" })
        .success,
    ).toBe(false);
  });

  test("exports named JSON Schemas for language-neutral consumers", () => {
    expect(Object.keys(learningContractJsonSchemas).sort()).toEqual(
      expect.arrayContaining([
        "BlobLocatorV1",
        "InsightV1",
        "LearningContainerV1",
        "RunSnapshotV1",
        "SkillCandidateV1",
        "SkillSetProjectionV1",
      ]),
    );
    expect(learningContractJsonSchemas.LearningContainerV1).toMatchObject({
      type: "object",
    });
  });

  test("publishes frozen available skill descriptions as string or null", () => {
    expect(learningContractJsonSchemas.LearningWorkflowInputV1).toMatchObject({
      properties: {
        availableSkills: {
          items: {
            properties: {
              description: {
                anyOf: expect.arrayContaining([
                  { type: "string" },
                  { type: "null" },
                ]),
              },
            },
          },
        },
      },
    });
  });
});
