import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  comparePersistence,
  verifyMedia,
  witnessAt,
  verifyNativeCompleted,
} from "./row1.mjs";

test("native completion requires the original interrupt and captured resume decision", () => {
  const emitted = {
    events: [
      {
        input: {
          resume: [{ interruptId: "original", value: { approved: true } }],
        },
      },
    ],
    messages: [{ role: "assistant", content: "Done" }],
  };
  const action = {
    controlId: "original",
    resumePointer: "/events/0/input/resume/0",
    responsePointer: "/messages/0",
  };
  verifyNativeCompleted(emitted, action);
  assert.throws(
    () => verifyNativeCompleted(emitted, { ...action, controlId: "other" }),
    /another interrupt/,
  );
  delete emitted.events[0].input.resume[0].value;
  assert.throws(() => verifyNativeCompleted(emitted, action), /decision/);
});

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

test("missing generation and media coverage stay unvalidated, not persistence failures", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { row } = await import("./row1.mjs");
  const directory = await mkdtemp(join(tmpdir(), "row1-coverage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "unit-only-screenshot.png"),
    "unit fixture; not browser evidence",
  );
  const emitted = capture();
  const context = {
    outputDir: directory,
    writeArtifact: async (name) => name,
    fixture: {
      row1: {
        scenarios: [{ id: "missing-media", categories: ["image:data"] }],
      },
    },
    services: {
      row1: {
        runFresh: async () => ({
          emitted,
          browser: {
            fresh: true,
            url: "http://example.invalid",
            screenshots: ["unit-only-screenshot.png"],
          },
          witnesses: [
            { category: "image:data", pointer: "/messages/0/content" },
          ],
        }),
        readSaved: async () => structuredClone(emitted),
      },
    },
  };
  const result = await row.run(context);
  assert.equal(result.status, "unvalidated");
  assert.equal(result.checks[0].layer, "coverage");
  assert.match(result.checks[0].detail, /never emitted/);
});
test("unavailable browser/runtime is a setup blocker", async () => {
  const { row } = await import("./row1.mjs");
  const result = await row.run({
    fixture: {
      row1: { scenarios: [{ id: "fresh", categories: ["user-text"] }] },
    },
    services: {
      row1: {
        runFresh: async () => {
          throw Error("ECONNREFUSED");
        },
        readSaved: async () => {
          throw Error("must not read");
        },
      },
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.checks[0].layer, "environment");
});

test("faithfully saved repeated source occurrences and wrong model values are not invented persistence loss", () => {
  const emitted = capture();
  emitted.events[4].content.values = [999, -2];
  emitted.events.splice(5, 0, structuredClone(emitted.events[4]));
  assert.equal(comparePersistence(emitted, structuredClone(emitted)).events, 7);
});

test("completed approval needs original call result and subsequent assistant response", async () => {
  const { verifyCompletedControl } = await import("./row1.mjs");
  const source = capture();
  source.messages.push({
    id: "reply-after-approval",
    role: "assistant",
    content: "Approval saved",
  });
  const interaction = {
    toolCallId: "pie-1",
    callIdPointer: "/events/1/toolCallId",
    resultPointer: "/messages/2",
    responsePointer: "/messages/3",
  };
  verifyCompletedControl(source, interaction);
  const wrong = structuredClone(source);
  wrong.messages[2].toolCallId = "another-call";
  assert.throws(
    () => verifyCompletedControl(wrong, interaction),
    /another call/,
  );
  assert.throws(
    () =>
      verifyCompletedControl(source, {
        ...interaction,
        responsePointer: "/messages/0",
      }),
    /assistant response/,
  );
  const early = structuredClone(source);
  early.messages.unshift(early.messages.pop());
  assert.throws(
    () =>
      verifyCompletedControl(early, {
        ...interaction,
        resultPointer: "/messages/3",
        responsePointer: "/messages/0",
      }),
    /precedes/,
  );
});

test("a reader cannot change the source snapshot to hide corruption", async () => {
  const { row } = await import("./row1.mjs");
  const result = await row.run({
    fixture: {
      row1: { scenarios: [{ id: "mutation", categories: ["user-text"] }] },
    },
    writeArtifact: async (name) => name,
    services: {
      row1: {
        runFresh: async () => ({ emitted: capture() }),
        readSaved: async (emitted) => {
          emitted.events.splice(2, 1);
          return emitted;
        },
      },
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.checks[0].layer, "intelligence-persistence");
});
