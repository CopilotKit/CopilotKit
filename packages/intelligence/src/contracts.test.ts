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
  learningRunV1Schema,
  learningWorkflowInputV1Schema,
  learningWorkflowOutputV1Schema,
  runSnapshotV1Schema,
  skillArtifactManifestV1Schema,
  skillBundleV1Schema,
  skillCandidateV1Schema,
  skillSetProjectionEntryV1Schema,
  skillSetProjectionV1Schema,
  threadAssignmentPatchV1Schema,
  workflowThreadV1Schema,
} from "./contracts.js";
import { learningContractJsonSchemas } from "./schema-registry.js";

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
const CANONICAL_BASE64_PATTERN =
  "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?(?![\\s\\S])";
const SAFE_RELATIVE_PATH_PATTERN =
  "^(?![A-Za-z]:)(?!.*[\\u0000-\\u001F\\u007F\\\\])(?!(?:.*\\/)?\\.{1,2}(?:\\/|$))[^/]+(?:\\/[^/]+)*(?![\\s\\S])";
const SKILL_ROOT_DIRECTORY_NAME_PATTERN =
  "^[a-z0-9]+(?:-[a-z0-9]+)*(?![\\s\\S])";

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
  terminalError: null,
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
  retainedEvidence: { schemaVersion: 1, events: [] },
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

const boundProjectionEntry = {
  skillId: UUIDS.skill,
  versionId: UUIDS.version,
  position: 0,
  name: "Idempotent retries",
  description: null,
  bundleLocator: frozenAvailableSkill.bundle.locator,
  bundleSha256: SHA_B,
  manifestSha256: SHA_A,
  bundleByteLength: 12,
  manifest: frozenAvailableSkill.bundle.manifest,
  approvalMethod: "manual",
} as const;

const orderedProjection = {
  schemaVersion: 1,
  learningContainerId: UUIDS.container,
  registryRevision: "revision_1",
  skillSetHash: SHA_A,
  etag: '"registry-1"',
  entries: [
    boundProjectionEntry,
    {
      ...boundProjectionEntry,
      skillId: UUIDS.snapshotSecond,
      versionId: UUIDS.attempt,
      position: 1,
    },
  ],
  publishedAt: NOW,
  revoked: false,
} as const;

function artifactManifestWithPaths(paths: readonly string[]) {
  const template = frozenAvailableSkill.bundle.manifest;
  return {
    ...template,
    files: paths.map((path) => ({ ...template.files[0], path })),
  };
}

const workflowInput = {
  schemaVersion: 1,
  threads: [
    {
      snapshotId: UUIDS.snapshot,
      snapshotSha256: SHA_A,
      threadId: "thread_1",
      externalRunId: "run_external_1",
      messages: snapshot.messages,
      terminalError: null,
      attachments: [],
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
      terminalError: null,
      attachments: [],
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
  test("accepts safe artifact manifest paths and NFC-distinct compatibility characters", () => {
    expect(
      skillArtifactManifestV1Schema.safeParse(
        artifactManifestWithPaths([
          "SKILL.md",
          "references/caf\u00e9.txt",
          "references/1.txt",
          "references/\u2460.txt",
        ]),
      ).success,
    ).toBe(true);
  });

  test.each([
    "../escape.txt",
    "references/../../escape.txt",
    "/absolute.txt",
    "C:/absolute.txt",
    "C:relative.txt",
    "references\\windows.txt",
    "references//empty.txt",
    "references/./same.txt",
    "references/\u0007control.txt",
  ])("rejects unsafe artifact manifest file path %j", (path) => {
    expect(
      skillArtifactManifestV1Schema.safeParse(
        artifactManifestWithPaths(["SKILL.md", path]),
      ).success,
    ).toBe(false);
  });

  test.each([
    ["same.txt", "same.txt"],
    ["Case.txt", "case.txt"],
    ["caf\u00e9.txt", "cafe\u0301.txt"],
  ])("rejects artifact manifest path collision %j and %j", (left, right) => {
    expect(
      skillArtifactManifestV1Schema.safeParse(
        artifactManifestWithPaths(["SKILL.md", left, right]),
      ).success,
    ).toBe(false);
  });

  test.each([
    { name: "missing SKILL.md", paths: ["README.md"] },
    {
      name: "only a root-prefixed SKILL.md",
      paths: ["idempotent-retries/SKILL.md"],
    },
  ])("rejects an artifact manifest with $name", ({ paths }) => {
    expect(
      skillArtifactManifestV1Schema.safeParse(artifactManifestWithPaths(paths))
        .success,
    ).toBe(false);
  });

  test.each([
    {
      name: "hash",
      value: {
        ...frozenAvailableSkill.bundle,
        locator: {
          ...frozenAvailableSkill.bundle.locator,
          applicationSha256: SHA_A,
        },
      },
    },
    {
      name: "byte length",
      value: {
        ...frozenAvailableSkill.bundle,
        locator: {
          ...frozenAvailableSkill.bundle.locator,
          byteLength: 13,
        },
      },
    },
  ])("rejects a skill bundle with a mismatched $name", ({ value }) => {
    expect(skillBundleV1Schema.safeParse(value).success).toBe(false);
  });

  test.each([
    {
      name: "hash",
      value: {
        ...boundProjectionEntry,
        bundleLocator: {
          ...boundProjectionEntry.bundleLocator,
          applicationSha256: SHA_A,
        },
      },
    },
    {
      name: "byte length",
      value: {
        ...boundProjectionEntry,
        bundleLocator: {
          ...boundProjectionEntry.bundleLocator,
          byteLength: 13,
        },
      },
    },
  ])("rejects a projection entry with a mismatched $name", ({ value }) => {
    expect(skillSetProjectionEntryV1Schema.safeParse(value).success).toBe(
      false,
    );
  });

  test("requires the canonical artifact manifest on projection entries", () => {
    const { manifest: _manifest, ...withoutManifest } = {
      ...boundProjectionEntry,
      manifest: frozenAvailableSkill.bundle.manifest,
    };

    expect(
      skillSetProjectionEntryV1Schema.safeParse(withoutManifest).success,
    ).toBe(false);
  });

  test.each([
    {
      name: "bundle hash",
      manifest: {
        ...frozenAvailableSkill.bundle.manifest,
        bundleSha256: SHA_A,
      },
    },
    {
      name: "manifest hash",
      manifest: {
        ...frozenAvailableSkill.bundle.manifest,
        manifestSha256: SHA_B,
      },
    },
    {
      name: "bundle byte length",
      manifest: {
        ...frozenAvailableSkill.bundle.manifest,
        bundleByteLength: 13,
      },
    },
  ])(
    "rejects a projection entry with a mismatched manifest $name",
    ({ manifest }) => {
      expect(
        skillSetProjectionEntryV1Schema.safeParse({
          ...boundProjectionEntry,
          manifest,
        }).success,
      ).toBe(false);
    },
  );

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
    { name: "one byte", contentBase64: "AA==" },
    { name: "two bytes", contentBase64: "AAA=" },
    { name: "complete quantum", contentBase64: "AAAA" },
    { name: "standard alphabet", contentBase64: "+/8=" },
  ])("accepts canonical base64 for $name", ({ contentBase64 }) => {
    expect(
      generatedSkillCandidateV1Schema.safeParse({
        ...generatedCandidate,
        bundle: {
          ...generatedCandidate.bundle,
          files: [
            ...generatedCandidate.bundle.files,
            { path: "asset.bin", contentBase64 },
          ],
        },
      }).success,
    ).toBe(true);
  });

  test("accepts a safe single root with nested normalized relative files", () => {
    expect(
      generatedSkillCandidateV1Schema.safeParse({
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
      }).success,
    ).toBe(true);
  });

  test.each([
    ".",
    "..",
    "/skill",
    "a/b",
    "a\\b",
    "Uppercase-skill",
    "skill_name",
  ])("rejects unsafe or non-single generated bundle root %j", (root) => {
    expect(
      generatedSkillCandidateV1Schema.safeParse({
        ...generatedCandidate,
        bundle: { ...generatedCandidate.bundle, rootDirectoryName: root },
      }).success,
    ).toBe(false);
  });

  test.each([
    "../escape.txt",
    "references/../../escape.txt",
    "/absolute.txt",
    "C:/absolute.txt",
    "C:relative.txt",
    "references\\windows.txt",
    "references//empty.txt",
    "references/./same.txt",
    "references/\u0007control.txt",
  ])("rejects unsafe generated bundle file path %j", (path) => {
    expect(
      generatedSkillCandidateV1Schema.safeParse({
        ...generatedCandidate,
        bundle: {
          ...generatedCandidate.bundle,
          files: [
            ...generatedCandidate.bundle.files,
            { path, contentBase64: "eA==" },
          ],
        },
      }).success,
    ).toBe(false);
  });

  test.each([
    ["same.txt", "same.txt"],
    ["Case.txt", "case.txt"],
    ["caf\u00e9.txt", "cafe\u0301.txt"],
    ["1.txt", "\u2460.txt"],
  ])("rejects generated bundle path collision %j and %j", (left, right) => {
    expect(
      generatedSkillCandidateV1Schema.safeParse({
        ...generatedCandidate,
        bundle: {
          ...generatedCandidate.bundle,
          files: [
            ...generatedCandidate.bundle.files,
            { path: left, contentBase64: "bGVmdA==" },
            { path: right, contentBase64: "cmlnaHQ=" },
          ],
        },
      }).success,
    ).toBe(false);
  });

  test.each([
    {
      name: "no SKILL.md",
      files: [{ path: "README.md", contentBase64: "eA==" }],
    },
    {
      name: "a root-prefixed SKILL.md",
      files: [
        {
          path: "idempotent-retries/SKILL.md",
          contentBase64: "IyBTa2lsbA==",
        },
      ],
    },
  ])("rejects a generated bundle with $name", ({ files }) => {
    expect(
      generatedSkillCandidateV1Schema.safeParse({
        ...generatedCandidate,
        bundle: { ...generatedCandidate.bundle, files },
      }).success,
    ).toBe(false);
  });

  test.each([
    { name: "empty file content", contentBase64: "" },
    { name: "missing padding", contentBase64: "AA" },
    { name: "malformed padding", contentBase64: "AA=" },
    { name: "excess padding", contentBase64: "AA===" },
    { name: "interior padding", contentBase64: "A=AA" },
    { name: "URL-safe alphabet", contentBase64: "__8=" },
    { name: "whitespace", contentBase64: "AA==\n" },
    { name: "invalid alphabet", contentBase64: "AA!=" },
    { name: "non-zero one-byte pad bits", contentBase64: "AB==" },
    { name: "non-zero two-byte pad bits", contentBase64: "AAB=" },
  ])("rejects $name in base64 file content", ({ contentBase64 }) => {
    expect(
      generatedSkillCandidateV1Schema.safeParse({
        ...generatedCandidate,
        bundle: {
          ...generatedCandidate.bundle,
          files: [
            ...generatedCandidate.bundle.files,
            { path: "asset.bin", contentBase64 },
          ],
        },
      }).success,
    ).toBe(false);
  });

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

  test("resolves annotation snapshot UUIDs case-insensitively", () => {
    expect(
      learningWorkflowInputV1Schema.safeParse({
        ...workflowInput,
        selectedAnnotations: [
          {
            ...workflowInput.selectedAnnotations[0],
            targetSnapshotId: UUIDS.snapshot.toUpperCase(),
          },
        ],
      }).success,
    ).toBe(true);
  });

  test("rejects case-variant duplicate workflow snapshot UUIDs", () => {
    expect(
      learningWorkflowInputV1Schema.safeParse({
        ...workflowInput,
        threads: [
          workflowInput.threads[0],
          {
            ...workflowInput.threads[1],
            snapshotId: UUIDS.snapshot.toUpperCase(),
          },
        ],
      }).success,
    ).toBe(false);
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

  test.each([
    {
      name: "duplicate source-event IDs",
      value: {
        ...snapshot,
        sourceEvents: [
          ...snapshot.sourceEvents,
          { ...snapshot.sourceEvents[0], sequence: 3 },
        ],
      },
    },
    {
      name: "duplicate message IDs",
      value: {
        ...snapshot,
        messages: [
          ...snapshot.messages,
          {
            ...snapshot.messages[0],
            toolCalls: [],
            toolResults: [],
          },
        ],
      },
    },
    {
      name: "duplicate retained-event IDs",
      value: {
        ...snapshot,
        retainedEvidence: {
          schemaVersion: 1,
          events: [
            {
              eventId: "event_custom",
              type: "CUSTOM",
              timestamp: NOW,
              payload: {},
            },
            {
              eventId: "event_custom",
              type: "CUSTOM",
              timestamp: NOW,
              payload: { repeated: true },
            },
          ],
        },
      },
    },
    {
      name: "duplicate tool-call IDs",
      value: {
        ...snapshot,
        messages: [
          {
            ...snapshot.messages[0],
            toolCalls: [
              ...snapshot.messages[0].toolCalls,
              { id: "call_1", name: "duplicate", argsText: "{}" },
            ],
          },
        ],
      },
    },
    {
      name: "message event IDs outside the source-event manifest",
      value: {
        ...snapshot,
        messages: [{ ...snapshot.messages[0], eventIds: ["event_missing"] }],
      },
    },
    {
      name: "a tool-result name that differs from its call",
      value: {
        ...snapshot,
        messages: [
          {
            ...snapshot.messages[0],
            toolResults: [
              { ...snapshot.messages[0].toolResults[0], name: "lookup" },
            ],
          },
        ],
      },
    },
  ])("rejects snapshots with $name", ({ value }) => {
    expect(runSnapshotV1Schema.safeParse(value).success).toBe(false);
  });

  test.each([
    {
      name: "duplicate message IDs",
      value: {
        ...workflowInput.threads[0],
        messages: [
          ...workflowInput.threads[0].messages,
          {
            ...workflowInput.threads[0].messages[0],
            toolCalls: [],
            toolResults: [],
          },
        ],
      },
    },
    {
      name: "duplicate tool-call IDs",
      value: {
        ...workflowInput.threads[0],
        messages: [
          {
            ...workflowInput.threads[0].messages[0],
            toolCalls: [
              ...workflowInput.threads[0].messages[0].toolCalls,
              { id: "call_1", name: "duplicate", argsText: "{}" },
            ],
          },
        ],
      },
    },
    {
      name: "a tool-result name that differs from its call",
      value: {
        ...workflowInput.threads[0],
        messages: [
          {
            ...workflowInput.threads[0].messages[0],
            toolResults: [
              {
                ...workflowInput.threads[0].messages[0].toolResults[0],
                name: "lookup",
              },
            ],
          },
        ],
      },
    },
  ])("rejects workflow threads with $name", ({ value }) => {
    expect(workflowThreadV1Schema.safeParse(value).success).toBe(false);
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

  test.each([
    { name: "a non-terminal event", type: "TEXT_MESSAGE_END" },
    { name: "the other terminal type", type: "RUN_ERROR" },
  ])("rejects $name at the declared terminal event ID", ({ type }) => {
    expect(
      runSnapshotV1Schema.safeParse({
        ...snapshot,
        sourceEvents: snapshot.sourceEvents.map((event) =>
          event.eventId === snapshot.terminalEventId
            ? { ...event, type }
            : event,
        ),
      }).success,
    ).toBe(false);
  });

  test("rejects a second terminal-typed source event", () => {
    expect(
      runSnapshotV1Schema.safeParse({
        ...snapshot,
        sourceEvents: [
          ...snapshot.sourceEvents,
          {
            eventId: "event_later_terminal",
            sequence: 3,
            type: "RUN_ERROR",
            sha256: SHA_A,
          },
        ],
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

  test("treats case variants of a snapshot UUID as the same frozen identity", () => {
    expect(
      learningRunV1Schema.safeParse({
        ...learningRun,
        snapshotIdsAndHashes: [
          learningRun.snapshotIdsAndHashes[0],
          {
            ...learningRun.snapshotIdsAndHashes[1],
            snapshotId: UUIDS.snapshot.toUpperCase(),
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("requires selected annotations to target a frozen snapshot", () => {
    expect(
      learningRunV1Schema.safeParse({
        ...learningRun,
        selectedAnnotations: [
          {
            ...workflowInput.selectedAnnotations[0],
            targetSnapshotId: UUIDS.container,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      learningRunV1Schema.safeParse({
        ...learningRun,
        selectedAnnotations: [
          {
            ...workflowInput.selectedAnnotations[0],
            targetSnapshotId: UUIDS.snapshot.toUpperCase(),
          },
        ],
      }).success,
    ).toBe(true);
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
          bundleLocator: {
            ...candidate.bundleLocator,
            applicationSha256: SHA_B,
          },
        }).success,
      ).toBe(false);
    }
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

  test("accepts a complete projection with unique skills in contiguous order", () => {
    expect(skillSetProjectionV1Schema.parse(orderedProjection)).toEqual(
      orderedProjection,
    );
  });

  test.each([
    {
      name: "a revoked projection with entries",
      value: { ...orderedProjection, revoked: true },
    },
    {
      name: "a position above the six-digit cache bound",
      value: {
        ...orderedProjection,
        entries: [{ ...boundProjectionEntry, position: 1_000_000 }],
      },
    },
    {
      name: "an unsafe integer position",
      value: {
        ...orderedProjection,
        entries: [
          {
            ...boundProjectionEntry,
            position: Number.MAX_SAFE_INTEGER + 1,
          },
        ],
      },
    },
    {
      name: "duplicate positions",
      value: {
        ...orderedProjection,
        entries: [
          boundProjectionEntry,
          { ...orderedProjection.entries[1], position: 0 },
        ],
      },
    },
    {
      name: "positions with a gap",
      value: {
        ...orderedProjection,
        entries: [
          boundProjectionEntry,
          { ...orderedProjection.entries[1], position: 2 },
        ],
      },
    },
    {
      name: "positions outside array order",
      value: {
        ...orderedProjection,
        entries: [orderedProjection.entries[1], boundProjectionEntry],
      },
    },
    {
      name: "duplicate skill identities",
      value: {
        ...orderedProjection,
        entries: [
          {
            ...boundProjectionEntry,
            skillId: orderedProjection.entries[1].skillId,
          },
          {
            ...orderedProjection.entries[1],
            skillId: orderedProjection.entries[1].skillId.toUpperCase(),
          },
        ],
      },
    },
  ])("rejects $name", ({ value }) => {
    expect(skillSetProjectionV1Schema.safeParse(value).success).toBe(false);
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
      bundleSha256: SHA_A,
      manifestSha256: SHA_A,
      bundleByteLength: 12,
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
        bundleSha256: SHA_A,
        bundleByteLength: 12,
        provenance: {},
      },
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
          bundleSha256: SHA_A,
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

  test("publishes canonical base64 validation in JSON Schema", () => {
    expect(learningContractJsonSchemas.LearningWorkflowOutputV1).toMatchObject({
      properties: {
        skillCandidates: {
          items: {
            properties: {
              bundle: {
                anyOf: [
                  {
                    properties: {
                      files: {
                        items: {
                          properties: {
                            contentBase64: {
                              minLength: 1,
                              pattern: CANONICAL_BASE64_PATTERN,
                              type: "string",
                            },
                          },
                        },
                      },
                    },
                  },
                  { type: "null" },
                ],
              },
            },
          },
        },
      },
    });
  });

  test("publishes generated bundle root and relative path rules in JSON Schema", () => {
    expect(learningContractJsonSchemas.LearningWorkflowOutputV1).toMatchObject({
      properties: {
        skillCandidates: {
          items: {
            properties: {
              bundle: {
                anyOf: [
                  {
                    properties: {
                      rootDirectoryName: {
                        maxLength: 512,
                        pattern: SKILL_ROOT_DIRECTORY_NAME_PATTERN,
                        type: "string",
                      },
                      files: {
                        items: {
                          properties: {
                            path: {
                              maxLength: 512,
                              pattern: SAFE_RELATIVE_PATH_PATTERN,
                              type: "string",
                            },
                          },
                        },
                      },
                    },
                  },
                  { type: "null" },
                ],
              },
            },
          },
        },
      },
    });

    expect(learningContractJsonSchemas.SkillArtifactManifestV1).toMatchObject({
      properties: {
        files: {
          items: {
            properties: {
              path: {
                maxLength: 512,
                pattern: SAFE_RELATIVE_PATH_PATTERN,
                type: "string",
              },
            },
          },
        },
      },
    });
  });
});
