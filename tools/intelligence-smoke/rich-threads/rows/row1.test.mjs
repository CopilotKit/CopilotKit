import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { comparePersistence, verifyMedia, witnessAt } from "./row1.mjs";

const capture = () => ({
  threadId: "thread-1",
  userId: "user-1",
  agentId: "agent-1",
  runIds: ["run-1"],
  events: [
    { type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" },
    { type: "TOOL_CALL_START", toolCallId: "pie-1", toolCallName: "pie" },
    { type: "TOOL_CALL_ARGS", toolCallId: "pie-1", delta: '{"values":[2,4]}' },
    {
      type: "TOOL_CALL_RESULT",
      toolCallId: "pie-1",
      content: '{"rendered":true}',
    },
    {
      type: "ACTIVITY_SNAPSHOT",
      messageId: "surface-1",
      content: { toolCallId: "pie-1", values: [2, 4] },
    },
    { type: "RUN_ERROR", message: "Unsupported audio input", code: "model" },
  ],
  messages: [
    { id: "user-1", role: "user", content: "Chart" },
    {
      id: "assistant-1",
      role: "assistant",
      toolCalls: [
        {
          id: "pie-1",
          function: { name: "pie", arguments: '{"values":[2,4]}' },
        },
      ],
    },
    {
      id: "result-1",
      role: "tool",
      toolCallId: "pie-1",
      content: '{"rendered":true}',
    },
  ],
  state: {
    todos: [{ id: "todo-1", title: "Prepare", description: "Ship evidence" }],
  },
  pending: [
    { type: "native", id: "interrupt-1", payload: { action: "confirm" } },
  ],
});

test("exact rich events pass including persisted model errors", () => {
  const source = capture();
  assert.equal(comparePersistence(source, structuredClone(source)).events, 6);
});
for (const [name, mutate] of [
  ["missing event", (s) => s.events.splice(2, 1)],
  ["duplicate occurrence", (s) => s.events.push(s.events[2])],
  ["reordered calls", (s) => s.events.reverse()],
  ["chart value corruption", (s) => (s.events[4].content.values[0] = 3)],
  ["cross-call association", (s) => (s.events[3].toolCallId = "other-call")],
  [
    "wrong independent surface",
    (s) => (s.events[4].content.toolCallId = "other-call"),
  ],
  ["dropped run error", (s) => s.events.pop()],
  ["missing message", (s) => s.messages.shift()],
  [
    "changed arguments",
    (s) => (s.messages[1].toolCalls[0].function.arguments = "{}"),
  ],
  ["lost state field", (s) => delete s.state.todos[0].description],
  ["lost pending identity", (s) => (s.pending[0].id = "other-interrupt")],
  ["wrong thread", (s) => (s.threadId = "other-thread")],
  ["wrong run order", (s) => s.runIds.unshift("other-run")],
])
  test(`detects ${name}`, () => {
    const source = capture();
    const saved = structuredClone(source);
    mutate(saved);
    assert.throws(() => comparePersistence(source, saved));
  });
test("empty input never establishes fidelity", () => {
  const source = capture();
  source.events = [];
  assert.throws(
    () => comparePersistence(source, structuredClone(source)),
    /No emitted events/,
  );
});
test("witness must resolve original captured content", () => {
  assert.equal(witnessAt(capture(), "/pending/0/id"), "interrupt-1");
  assert.throws(() => witnessAt(capture(), "/messages/3"), /Missing witness/);
  assert.throws(() => witnessAt(capture(), "/threadId"), /captured source/);
});
for (const type of ["image", "document", "audio", "video"])
  test(`${type} bytes, type, MIME and filename survive independently of model acceptance`, () => {
    const bytes = Buffer.from(`${type}-original-bytes`);
    const part = {
      type,
      mimeType: `${type}/fixture`,
      filename: `${type}.fixture`,
      source: { type: "data", value: bytes.toString("base64") },
    };
    part.source.mimeType = part.mimeType;
    part.metadata = { filename: part.filename };
    const source = {
      events: [
        { type: "RUN_STARTED", input: { messages: [{ content: [part] }] } },
      ],
    };
    const media = {
      pointer: "/events/0/input/messages/0/content/0",
      type,
      mimeType: part.mimeType,
      filename: part.filename,
      sourceType: "data",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    verifyMedia(source, media);
    for (const key of ["type", "filename", "mimeType"]) {
      const bad = structuredClone(source);
      const p = bad.events[0].input.messages[0].content[0];
      if (key === "filename") p.metadata.filename = "corrupted";
      else if (key === "mimeType") p.source.mimeType = "corrupted";
      else p[key] = "corrupted";
      assert.throws(() => verifyMedia(bad, media));
    }
    part.source.value = Buffer.from("wrong bytes").toString("base64");
    assert.throws(() => verifyMedia(source, media), /bytes changed/);
  });
test("URL equality cannot stand in for durable resource bytes", () => {
  const source = {
    messages: [
      {
        content: [
          {
            type: "image",
            metadata: { filename: "image.png" },
            source: {
              type: "url",
              value: "https://example.invalid/image.png",
              mimeType: "image/png",
            },
          },
        ],
      },
    ],
  };
  assert.throws(
    () =>
      verifyMedia(source, {
        pointer: "/messages/0/content/0",
        type: "image",
        filename: "image.png",
        mimeType: "image/png",
        sourceType: "url",
        sha256: "a".repeat(64),
      }),
    /Saved attachment bytes/,
  );
});
