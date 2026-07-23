import { describe, expect, test } from "vitest";
import {
  attachmentReferenceV1Schema,
  learningWorkflowInputV1Schema,
  runSnapshotV1Schema,
  terminalErrorV1Schema,
} from "./contracts.js";
import { createLearningContractJsonSchemaValidator } from "./portable-validator.js";
import {
  learningContractJsonSchemas,
  learningContractSchemas,
} from "./schema-registry.js";

const UUIDS = {
  container: "11111111-1111-4111-8111-111111111111",
  snapshot: "22222222-2222-4222-8222-222222222222",
} as const;
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const NOW = "2026-07-20T12:35:00.000Z";

function deeplyNestedArray(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

function withSerializedUtf8Bytes<T extends Record<string, unknown>>(
  value: T,
  targetBytes: number,
): T & { extension: string } {
  const empty = { ...value, extension: "" };
  const paddingBytes = targetBytes - Buffer.byteLength(JSON.stringify(empty));
  if (paddingBytes < 0) {
    throw new Error(`Cannot fit fixture in ${targetBytes} bytes`);
  }
  return { ...value, extension: "a".repeat(paddingBytes) };
}

function payloadWithSerializedUtf8Bytes(targetBytes: number) {
  let entryCount = 1;
  let entries = Array.from({ length: entryCount }, (_, index) => [
    `k${index}`,
    "",
  ]);
  while (
    targetBytes -
      Buffer.byteLength(JSON.stringify(Object.fromEntries(entries))) >
    entryCount * 16_384
  ) {
    entryCount += 1;
    entries = Array.from({ length: entryCount }, (_, index) => [
      `k${index}`,
      "",
    ]);
  }
  let remaining =
    targetBytes -
    Buffer.byteLength(JSON.stringify(Object.fromEntries(entries)));
  for (const entry of entries) {
    const length = Math.min(16_384, remaining);
    entry[1] = "a".repeat(length);
    remaining -= length;
  }
  if (remaining !== 0) {
    throw new Error(`Unable to build ${targetBytes}-byte payload`);
  }
  return Object.fromEntries(entries);
}

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
} as const;

const terminalError = {
  schemaVersion: 1,
  message: "The run failed.",
  code: "MODEL_FAILED",
  category: "model",
  details: { attempt: 1 },
  stack: null,
} as const;

const assistantCallMessage = {
  messageId: "message_call",
  role: "assistant",
  content: "searching",
  toolCalls: [{ id: "call_1", name: "search", argsText: "{}" }],
  toolResults: [],
  eventIds: ["event_call"],
  timestamp: NOW,
} as const;

const toolResultMessage = {
  messageId: "message_result",
  role: "tool",
  content: { hits: 1 },
  toolCalls: [],
  toolResults: [{ toolCallId: "call_1", status: "ok", output: { hits: 1 } }],
  eventIds: ["event_result"],
  timestamp: NOW,
} as const;

const finishedSnapshot = {
  schemaVersion: 1,
  snapshotId: UUIDS.snapshot,
  organizationId: "org_1",
  projectId: "project_1",
  learningContainerId: UUIDS.container,
  threadId: "thread_1",
  agentRunId: "agent_run_1",
  externalRunId: "external_run_1",
  terminalEventId: "event_terminal",
  terminalType: "RUN_FINISHED",
  terminalStatus: null,
  terminalError: null,
  startedAt: NOW,
  terminalAt: NOW,
  capturedAt: NOW,
  assignmentRevision: 1,
  sourceEvents: [
    {
      eventId: "event_call",
      sequence: 1,
      type: "TOOL_CALL_END",
      sha256: SHA_A,
    },
    {
      eventId: "event_terminal",
      sequence: 2,
      type: "RUN_FINISHED",
      sha256: SHA_B,
    },
  ],
  messages: [assistantCallMessage, toolResultMessage],
  retainedEvidence: {
    schemaVersion: 1,
    events: [
      {
        eventId: "event_custom",
        type: "CUSTOM",
        timestamp: NOW,
        payload: { answer: 42 },
      },
    ],
  },
  stateChanges: [],
  annotations: [],
  attachments: [attachment],
  normalizerVersion: "normalizer:v1",
  sanitizerVersion: "sanitizer:v1",
  contentSha256: SHA_A,
  byteLength: 100,
  tokenEstimate: 25,
  containerSequence: 1,
} as const;

const workflowInput = {
  schemaVersion: 1,
  threads: [
    {
      snapshotId: finishedSnapshot.snapshotId,
      snapshotSha256: finishedSnapshot.contentSha256,
      threadId: finishedSnapshot.threadId,
      externalRunId: finishedSnapshot.externalRunId,
      messages: finishedSnapshot.messages,
      terminalError: finishedSnapshot.terminalError,
      attachments: finishedSnapshot.attachments,
    },
  ],
  selectedAnnotations: [],
  availableSkills: [],
  promptContext: null,
  limits: {},
} as const;

function failedSnapshot() {
  return {
    ...finishedSnapshot,
    terminalType: "RUN_ERROR",
    terminalError,
    sourceEvents: [
      finishedSnapshot.sourceEvents[0],
      { ...finishedSnapshot.sourceEvents[1], type: "RUN_ERROR" },
    ],
  } as const;
}

describe("canonical snapshot evidence contracts", () => {
  test("registers exactly the two public evidence DTOs", () => {
    expect(Object.keys(learningContractSchemas)).toHaveLength(47);
    expect(Object.keys(learningContractSchemas)).toEqual(
      expect.arrayContaining(["AttachmentReferenceV1", "TerminalErrorV1"]),
    );
    expect(Object.keys(learningContractSchemas)).not.toEqual(
      expect.arrayContaining([
        "LearningResourceLimitsV1",
        "RetainedEvidenceEventV1",
        "RetainedEvidenceV1",
      ]),
    );
  });

  test("accepts complete strict attachment and terminal-error DTOs", () => {
    expect(attachmentReferenceV1Schema.parse(attachment)).toEqual(attachment);
    expect(terminalErrorV1Schema.parse(terminalError)).toEqual(terminalError);
  });

  test.each([
    ["attachment root", { ...attachment, rawAttachment: true }],
    [
      "attachment locator",
      {
        ...attachment,
        objectLocator: { ...attachment.objectLocator, body: "inline" },
      },
    ],
    [
      "attachment checksum",
      { ...attachment, checksum: { ...attachment.checksum, encoding: "hex" } },
    ],
  ])("rejects an unknown %s field", (_name, value) => {
    expect(attachmentReferenceV1Schema.safeParse(value).success).toBe(false);
  });

  test("enforces attachment UTF-8, entry, and recursive metadata bounds", () => {
    expect(
      attachmentReferenceV1Schema.safeParse({
        ...attachment,
        provider: "é".repeat(32),
      }).success,
    ).toBe(true);
    expect(
      attachmentReferenceV1Schema.safeParse({
        ...attachment,
        provider: "é".repeat(33),
      }).success,
    ).toBe(false);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        attachments: Array.from({ length: 33 }, () => attachment),
      }).success,
    ).toBe(false);
    expect(
      attachmentReferenceV1Schema.safeParse({
        ...attachment,
        metadata: { nested: { response_bytes: "inline" } },
      }).success,
    ).toBe(false);
    expect(
      attachmentReferenceV1Schema.safeParse({
        ...attachment,
        metadata: { values: Array.from({ length: 33 }, (_, index) => index) },
      }).success,
    ).toBe(false);
  });

  test("enforces bounded sanitized terminal-error evidence", () => {
    expect(runSnapshotV1Schema.safeParse(failedSnapshot()).success).toBe(true);
    expect(
      terminalErrorV1Schema.safeParse({
        ...terminalError,
        rawError: "must not cross",
      }).success,
    ).toBe(false);
    expect(
      terminalErrorV1Schema.safeParse({
        ...terminalError,
        message: "é".repeat(2_049),
      }).success,
    ).toBe(false);
    expect(
      terminalErrorV1Schema.safeParse({
        ...terminalError,
        details: { values: Array.from({ length: 65 }, (_, index) => index) },
      }).success,
    ).toBe(false);
  });

  test.each([
    ["deeply nested input", { nested: deeplyNestedArray(20_000) }],
    [
      "cyclic input",
      (() => {
        const value: { self?: unknown } = {};
        value.self = value;
        return value;
      })(),
    ],
    ["BigInt input", { value: 1n }],
    ["own __proto__ key", JSON.parse('{"__proto__":{"polluted":true}}')],
  ])("native evidence schemas fail closed for %s", (_name, value) => {
    const parseAttachment = () =>
      attachmentReferenceV1Schema.safeParse({ ...attachment, metadata: value });
    const parseTerminalError = () =>
      terminalErrorV1Schema.safeParse({ ...terminalError, details: value });

    expect(parseAttachment).not.toThrow();
    expect(parseAttachment().success).toBe(false);
    expect(parseTerminalError).not.toThrow();
    expect(parseTerminalError().success).toBe(false);
  });

  test("requires terminal errors exactly for RUN_ERROR snapshots", () => {
    expect(runSnapshotV1Schema.safeParse(finishedSnapshot).success).toBe(true);
    expect(
      runSnapshotV1Schema.safeParse({
        ...failedSnapshot(),
        terminalError: null,
      }).success,
    ).toBe(false);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        terminalError,
      }).success,
    ).toBe(false);
  });

  test("accepts omitted or typed inline retained evidence", () => {
    const { retainedEvidence: _retainedEvidence, ...withoutRetainedEvidence } =
      finishedSnapshot;
    expect(runSnapshotV1Schema.safeParse(withoutRetainedEvidence).success).toBe(
      true,
    );
    expect(runSnapshotV1Schema.safeParse(finishedSnapshot).success).toBe(true);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        retainedEvidence: { schemaVersion: 1, events: [{ nope: true }] },
      }).success,
    ).toBe(false);
  });

  test("preserves additive retained-evidence container and event fields", () => {
    const result = runSnapshotV1Schema.safeParse({
      ...finishedSnapshot,
      retainedEvidence: {
        ...finishedSnapshot.retainedEvidence,
        encoding: "sanitized-json-v2",
        events: [
          {
            ...finishedSnapshot.retainedEvidence.events[0],
            producerVersion: "runtime:v2",
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retainedEvidence).toMatchObject({
        encoding: "sanitized-json-v2",
        events: [{ producerVersion: "runtime:v2" }],
      });
    }
  });

  test("enforces retained-evidence entry count, entry, aggregate, and payload boundaries", () => {
    const event = finishedSnapshot.retainedEvidence.events[0];
    const atPayloadBoundary = {
      ...event,
      payload: payloadWithSerializedUtf8Bytes(32_768),
    };
    const overPayloadBoundary = {
      ...event,
      payload: payloadWithSerializedUtf8Bytes(32_769),
    };
    const atEntryBoundary = withSerializedUtf8Bytes(event, 65_536);
    const overEntryBoundary = withSerializedUtf8Bytes(event, 65_537);
    const retainedEvidence = finishedSnapshot.retainedEvidence;
    const atAggregateBoundary = withSerializedUtf8Bytes(
      retainedEvidence,
      8_388_608,
    );
    const overAggregateBoundary = withSerializedUtf8Bytes(
      retainedEvidence,
      8_388_609,
    );

    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        retainedEvidence: { schemaVersion: 1, events: [atPayloadBoundary] },
      }).success,
    ).toBe(true);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        retainedEvidence: { schemaVersion: 1, events: [overPayloadBoundary] },
      }).success,
    ).toBe(false);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        retainedEvidence: { schemaVersion: 1, events: [atEntryBoundary] },
      }).success,
    ).toBe(true);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        retainedEvidence: { schemaVersion: 1, events: [overEntryBoundary] },
      }).success,
    ).toBe(false);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        retainedEvidence: atAggregateBoundary,
      }).success,
    ).toBe(true);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        retainedEvidence: overAggregateBoundary,
      }).success,
    ).toBe(false);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        retainedEvidence: {
          schemaVersion: 1,
          events: Array.from({ length: 4_096 }, () => event),
        },
      }).success,
    ).toBe(true);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        retainedEvidence: {
          schemaVersion: 1,
          events: Array.from({ length: 4_097 }, () => event),
        },
      }).success,
    ).toBe(false);
  });

  test("requires activity type, activity metadata objects, and tool results", () => {
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        messages: [
          {
            ...assistantCallMessage,
            role: "activity",
            activityType: "status-card",
            activityMetadata: { phase: "complete" },
          },
          toolResultMessage,
        ],
      }).success,
    ).toBe(true);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        messages: [
          { ...assistantCallMessage, role: "activity" },
          toolResultMessage,
        ],
      }).success,
    ).toBe(false);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        messages: [
          assistantCallMessage,
          { ...toolResultMessage, toolResults: [] },
        ],
      }).success,
    ).toBe(false);
  });

  test("closes tool results over call IDs anywhere in snapshot messages", () => {
    expect(runSnapshotV1Schema.safeParse(finishedSnapshot).success).toBe(true);
    expect(
      runSnapshotV1Schema.safeParse({
        ...finishedSnapshot,
        messages: [
          assistantCallMessage,
          {
            ...toolResultMessage,
            toolResults: [
              { toolCallId: "missing", status: "ok", output: null },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("requires workflow evidence projections and message closure", () => {
    expect(learningWorkflowInputV1Schema.safeParse(workflowInput).success).toBe(
      true,
    );
    const { terminalError: _terminalError, ...withoutTerminalError } =
      workflowInput.threads[0];
    expect(
      learningWorkflowInputV1Schema.safeParse({
        ...workflowInput,
        threads: [withoutTerminalError],
      }).success,
    ).toBe(false);
    const { attachments: _attachments, ...withoutAttachments } =
      workflowInput.threads[0];
    expect(
      learningWorkflowInputV1Schema.safeParse({
        ...workflowInput,
        threads: [withoutAttachments],
      }).success,
    ).toBe(false);
    expect(
      learningWorkflowInputV1Schema.safeParse({
        ...workflowInput,
        threads: [
          {
            ...workflowInput.threads[0],
            messages: [
              assistantCallMessage,
              {
                ...toolResultMessage,
                toolResults: [
                  { toolCallId: "missing", status: "ok", output: null },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("carries evidence refinements into portable JSON Schema", () => {
    const portable = createLearningContractJsonSchemaValidator();
    const validateAttachment = portable.compile(
      learningContractJsonSchemas.AttachmentReferenceV1,
    );
    const validateTerminalError = portable.compile(
      learningContractJsonSchemas.TerminalErrorV1,
    );
    const validateSnapshot = portable.compile(
      learningContractJsonSchemas.RunSnapshotV1,
    );
    const validateThread = portable.compile(
      learningContractJsonSchemas.WorkflowThreadV1,
    );

    expect(validateAttachment(attachment)).toBe(true);
    expect(
      validateAttachment({ ...attachment, provider: "é".repeat(33) }),
    ).toBe(false);
    expect(
      validateAttachment({
        ...attachment,
        metadata: { nested: { dataBase64: "inline" } },
      }),
    ).toBe(false);
    expect(validateTerminalError(terminalError)).toBe(true);
    expect(
      validateTerminalError({
        ...terminalError,
        details: { values: Array.from({ length: 65 }, () => null) },
      }),
    ).toBe(false);
    expect(validateSnapshot(finishedSnapshot)).toBe(true);
    const retainedEvidenceEvent = finishedSnapshot.retainedEvidence.events[0];
    expect(
      validateSnapshot({
        ...finishedSnapshot,
        retainedEvidence: {
          schemaVersion: 1,
          events: [withSerializedUtf8Bytes(retainedEvidenceEvent, 65_536)],
        },
      }),
    ).toBe(true);
    expect(
      validateSnapshot({
        ...finishedSnapshot,
        retainedEvidence: {
          schemaVersion: 1,
          events: [withSerializedUtf8Bytes(retainedEvidenceEvent, 65_537)],
        },
      }),
    ).toBe(false);
    expect(
      validateSnapshot({
        ...finishedSnapshot,
        retainedEvidence: withSerializedUtf8Bytes(
          finishedSnapshot.retainedEvidence,
          8_388_608,
        ),
      }),
    ).toBe(true);
    expect(
      validateSnapshot({
        ...finishedSnapshot,
        retainedEvidence: withSerializedUtf8Bytes(
          finishedSnapshot.retainedEvidence,
          8_388_609,
        ),
      }),
    ).toBe(false);
    expect(
      validateSnapshot({
        ...finishedSnapshot,
        retainedEvidence: {
          schemaVersion: 1,
          events: Array.from({ length: 4_096 }, () => retainedEvidenceEvent),
        },
      }),
    ).toBe(true);
    expect(
      validateSnapshot({
        ...finishedSnapshot,
        retainedEvidence: {
          ...finishedSnapshot.retainedEvidence,
          encoding: "sanitized-json-v2",
          events: [
            {
              ...finishedSnapshot.retainedEvidence.events[0],
              producerVersion: "runtime:v2",
            },
          ],
        },
      }),
    ).toBe(true);
    expect(
      validateSnapshot({
        ...finishedSnapshot,
        retainedEvidence: {
          schemaVersion: 1,
          events: [
            {
              ...finishedSnapshot.retainedEvidence.events[0],
              payload: payloadWithSerializedUtf8Bytes(32_769),
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      validateSnapshot({
        ...finishedSnapshot,
        retainedEvidence: {
          schemaVersion: 1,
          events: Array.from(
            { length: 4_097 },
            () => finishedSnapshot.retainedEvidence.events[0],
          ),
        },
      }),
    ).toBe(false);
    expect(
      validateSnapshot({
        ...failedSnapshot(),
        terminalError: null,
      }),
    ).toBe(false);
    expect(
      validateSnapshot({
        ...finishedSnapshot,
        messages: [
          assistantCallMessage,
          {
            ...toolResultMessage,
            toolResults: [
              { toolCallId: "missing", status: "ok", output: null },
            ],
          },
        ],
      }),
    ).toBe(false);
    expect(validateThread(workflowInput.threads[0])).toBe(true);
  });
});
