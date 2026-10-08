import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { continuationPlan } from "../row4/scenarios.mjs";
import {
  occurrences,
  messageOccurrences,
  newRuns,
  observedResume,
  nativeSessions,
  observedMapping,
} from "../row4/observations.mjs";

test("real native inventory detects extra sessions without relying on Intelligence", async () => {
  const root = await mkdtemp(join(tmpdir(), "row4-inventory-"));
  try {
    await mkdir(join(root, "original"));
    assert.deepEqual(
      await nativeSessions("strands-typescript", { location: root }),
      ["original"],
    );
    await mkdir(join(root, "unexpected"));
    assert.deepEqual(
      await nativeSessions("strands-typescript", { location: root }),
      ["original", "unexpected"],
    );
    const location = join(root, "memory.db");
    const db = new DatabaseSync(location);
    db.exec(
      "CREATE TABLE mastra_threads(id TEXT PRIMARY KEY); INSERT INTO mastra_threads VALUES('original');",
    );
    assert.deepEqual(await nativeSessions("mastra", { location }), [
      "original",
    ]);
    db.exec("INSERT INTO mastra_threads VALUES('unexpected');");
    db.close();
    assert.deepEqual(await nativeSessions("mastra", { location }), [
      "original",
      "unexpected",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("projection preserves IDs/payloads and rejects unknown content", () => {
  const items = messageOccurrences([
    { id: 'native:"u1":segment:0', role: "user", content: "history" },
    {
      id: "a",
      role: "assistant",
      toolCalls: [
        {
          id: "c",
          function: { name: "pieChart", arguments: '{"values":[3,7]}' },
        },
      ],
    },
    { id: "t", role: "tool", toolCallId: "c", content: '{"values":[3,7]}' },
  ]);
  assert.equal(items[0].id, "u1");
  assert.deepEqual(
    items[1],
    occurrences([
      {
        id: "c",
        kind: "call",
        payload: { name: "pieChart", args: { values: [3, 7] } },
      },
    ])[0],
  );
  assert.deepEqual(items[2].payload, { values: [3, 7] });
  assert.throws(
    () =>
      messageOccurrences([
        {
          id: "x",
          role: "assistant",
          content: [{ type: "unhandled", value: 1 }],
        },
      ]),
    /Unprojected/,
  );
  assert.equal(
    messageOccurrences([
      {
        id: "x",
        role: "user",
        content: [
          { type: "text", text: "one" },
          { type: "text", text: "two" },
        ],
      },
    ]).length,
    2,
  );
});

test("source normalization never conceals conflicting arguments", () => {
  assert.throws(
    () =>
      occurrences([
        {
          id: "c",
          kind: "call",
          payload: { name: "x", args: { x: 1 }, arguments: { x: 2 } },
        },
      ]),
    /Conflicting/,
  );
});

test("new capture runs are selected by observed run ID, including errors", () => {
  const old = {
    input: { runId: "old", threadId: "native" },
    events: [{ type: "RUN_FINISHED" }],
  };
  const fresh = {
    input: { runId: "new", threadId: "native" },
    events: [{ type: "RUN_ERROR" }],
  };
  assert.deepEqual(newRuns({ runs: [old] }, { runs: [old, fresh] }), [fresh]);
  assert.throws(() => newRuns({ runs: [old] }, { runs: [old] }), /no new/);
  assert.throws(
    () => newRuns({ runs: [] }, { runs: [fresh, fresh] }),
    /Duplicate/,
  );
});

test("frontend resume binds actual submitted tool result to durable checkpoint", () => {
  const before = {
    pending: [
      {
        kind: "frontend",
        id: "picker",
        callId: "call",
        checkpoint: { id: "checkpoint" },
      },
    ],
  };
  const runs = [
    {
      input: {
        messages: [{ role: "tool", toolCallId: "call", content: '"Tomorrow"' }],
      },
    },
  ];
  assert.deepEqual(observedResume(before, runs), {
    resumedId: "picker",
    checkpointId: "checkpoint",
    answer: "Tomorrow",
  });
  runs[0].input.messages[0].toolCallId = "other";
  assert.throws(() => observedResume(before, runs), /No answer/);
});

test("native resume verifies actual interrupt ID and resolved status", () => {
  const before = {
    pending: [
      {
        kind: "native",
        id: "interrupt",
        callId: "call",
        checkpoint: { id: "checkpoint" },
      },
    ],
  };
  const runs = [
    {
      input: {
        resume: [
          {
            interruptId: "interrupt",
            status: "resolved",
            payload: { approved: true },
          },
        ],
      },
    },
  ];
  assert.deepEqual(observedResume(before, runs).answer, { approved: true });
  runs[0].input.resume[0].interruptId = "wrong";
  assert.throws(() => observedResume(before, runs), /different original/);
  runs[0].input.resume[0] = { interruptId: "interrupt", status: "cancelled" };
  assert.throws(() => observedResume(before, runs), /not resolved/);
});

test("durable mapping never uses expected source identities as observed values", () => {
  const mapping = observedMapping({
    threadId: "imported",
    agentId: "runtime",
    nativeIdentity: {
      threadId: "original",
      agentId: "native-agent",
      userId: "u",
      resourceId: "r",
    },
  });
  assert.equal(mapping.nativeId, "original");
  assert.equal(mapping.nativeAgentId, "native-agent");
  assert.throws(() => observedMapping({ threadId: "imported" }), /missing/);
});

test("multipart media preserves bytes, MIME, filename and original message identity", () => {
  const media = {
    type: "image",
    source: { type: "data", value: "YWJj", mimeType: "image/png" },
    metadata: { filename: "native.png" },
  };
  const projected = messageOccurrences([
    {
      id: 'native:"image-message":segment:1',
      role: "user",
      content: [{ type: "text", text: "caption" }, media],
    },
  ]);
  assert.equal(projected[0].id, "image-message");
  assert.equal(projected[1].id, "image-message");
  assert.deepEqual(projected[1].payload, {
    type: "image",
    mimeType: "image/png",
    filename: "native.png",
    base64: "YWJj",
    byteLength: 3,
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  });
  media.source = {
    type: "url",
    value: "https://test.invalid/image.png",
    mimeType: "image/png",
  };
  assert.throws(
    () => messageOccurrences([{ id: "m", role: "user", content: [media] }]),
    /Independent media bytes missing/,
  );
  assert.equal(
    messageOccurrences([{ id: "m", role: "user", content: [media] }], {
      "https://test.invalid/image.png": "YWJj",
    })[0].payload.base64,
    "YWJj",
  );
});

test("follow-up derives expected history and state before continuing", () => {
  const native = {
    items: [
      {
        kind: "text",
        role: "user",
        payload: "Remember the turquoise chart and its 13 entries.",
      },
    ],
    state: {
      todos: [{ id: "task-1", title: "Original task", status: "pending" }],
    },
    pending: [],
    evidence: "native.json",
  };
  const entry = {
    source: { id: "s" },
    native,
    imported: { absentBeforeImport: true, importEvidence: "cli.json" },
  };
  const plan = continuationPlan(entry);
  assert.ok(!plan.prompt.includes(plan.historyTokens[0]));
  assert.equal(plan.expectedState.todos[0].status, "completed");
  assert.equal(native.state.todos[0].status, "pending");
  assert.deepEqual(plan.stateChanges, [["todos"]]);
});

test("concrete composition opens imported identity, sends browser input and reads both stores", async () => {
  const { createContinuationServices } = await import("../row4/services.mjs");
  const root = await mkdtemp(join(tmpdir(), "row4-composition-"));
  await mkdir(join(root, "native", "original"), { recursive: true });
  const identity = { threadId: "original", agentId: "agent", userId: "user" };
  const history = [
    { id: "u1", role: "user", content: "Remember the turquoise chart." },
    {
      id: "a1",
      role: "assistant",
      toolCalls: [
        {
          id: "chart",
          function: { name: "pieChart", arguments: '{"values":[3,7]}' },
        },
      ],
    },
    {
      id: "r1",
      role: "tool",
      toolCallId: "chart",
      content: '{"values":[3,7]}',
    },
  ];
  const expected = {
    items: messageOccurrences(history),
    state: {},
    pending: [],
  };
  const source = {
    id: "source",
    nativeIdentity: identity,
    coverage: ["user-text", "chart-pie"],
    expected,
    provenance: {
      description: "unit transport fixture, not live acceptance",
      nativeOnly: true,
      durable: true,
      completeCheckpoint: true,
    },
  };
  const native = {
    ...structuredClone(expected),
    identity,
    rawCheckpoint: { complete: true },
    evidence: "source-native.json",
  };
  const imported = {
    ...structuredClone(expected),
    threadId: "imported",
    nativeIdentity: identity,
    agentId: "agent",
    absentBeforeImport: true,
    importEvidence: "cli.json",
  };
  let acted = false;
  let prompt;
  let nativeReads = 0;
  let importedReads = 0;
  const browser = {
    openThread: async (id) => {
      assert.equal(id, "imported");
      return { threadId: id };
    },
    snapshot: async () => ({ threadId: "imported", screenshot: "unit.png" }),
    send: async (thread, value) => {
      assert.equal(thread.threadId, "imported");
      prompt = value;
      acted = true;
      return { threadId: "imported", action: "send" };
    },
  };
  const currentMessages = () => [
    ...history,
    { id: "u2", role: "user", content: prompt },
    { id: "a2", role: "assistant", content: "Remember the turquoise chart." },
  ];
  const importReplay = {
    prepareImportedSources: async (options) => {
      assert.deepEqual(options, { answerPending: false, namespace: "row4" });
      return [{ source, native, imported }];
    },
    inspectNative: async () => {
      nativeReads++;
      return {
        ...native,
        items: acted ? messageOccurrences(currentMessages()) : native.items,
      };
    },
    readImported: async () => {
      importedReads++;
      return {
        ...imported,
        items: acted ? messageOccurrences(currentMessages()) : imported.items,
      };
    },
  };
  const capture = {
    read: async () => ({
      runs: acted
        ? [
            {
              input: {
                threadId: "original",
                runId: "run",
                messages: currentMessages(),
              },
              events: [{ type: "RUN_FINISHED", runId: "run" }],
              messages: currentMessages(),
              state: {},
            },
          ]
        : [],
    }),
  };
  try {
    const service = createContinuationServices({
      framework: "strands-typescript",
      scope: { native: { location: join(root, "native") } },
      browser,
      capture,
      importReplay,
      outputDir: join(root, "output"),
    }).services.continuation;
    const [fixture] = await service.sources();
    const before = await service.read(fixture);
    await service.open(fixture);
    const action = await service.followup(fixture);
    const after = await service.read(fixture);
    assert.equal(action.mapping.nativeId, "original");
    assert.equal(action.mapping.intelligenceId, "imported");
    assert.equal(action.newItems.length, 2);
    assert.equal(nativeReads, 2);
    assert.equal(importedReads, 3);
    const { verifyContinuation } = await import("./row4.mjs");
    verifyContinuation({ source: fixture, before, after, action });
    after.native.items.pop();
    assert.throws(
      () => verifyContinuation({ source: fixture, before, after, action }),
      /new user\/assistant\/tools/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
