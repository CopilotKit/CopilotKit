import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSource,
  assertImported,
  assertReplay,
  assertAnswered,
} from "../import/assertions.mjs";
import { row } from "./row3.mjs";
import { prepareImportedSources } from "../import/prepare.mjs";

function fixture() {
  const identity = { threadId: "native-3", agentId: "agent", userId: "user" };
  const pending = {
    id: "interrupt-3",
    callId: "call-3",
    kind: "native",
    args: { question: "Approve?" },
    checkpoint: { task: "original-task" },
    answer: "yes",
    result: { approved: true },
  };
  const items = [
    { id: "user-3", kind: "text", payload: "Show the chart" },
    {
      id: "media-3",
      kind: "media",
      payload: {
        base64: "AH+A/v8=",
        mime: "image/png",
        filename: "original.png",
      },
    },
    {
      id: "call-3",
      kind: "call",
      payload: { name: "approve", args: pending.args },
    },
  ];
  const expected = {
    items,
    pending: [pending],
    state: { todos: [{ id: "todo-3", description: "Keep this" }] },
  };
  const source = {
    id: "source-3",
    nativeIdentity: identity,
    provenance: {
      description: "Controlled assertion fixture (not E2E evidence)",
      nativeOnly: true,
      durable: true,
      completeCheckpoint: true,
    },
    expected,
    coverage: ["user-text", "assistant-text"],
    replay: [{ name: "chart", value: [1, 2] }],
  };
  const native = {
    identity,
    ...structuredClone(expected),
    rawCheckpoint: { messages: items, tasks: [pending] },
  };
  const imported = {
    threadId: "intelligence-3",
    nativeIdentity: identity,
    ...structuredClone(expected),
  };
  const replay = {
    threadId: imported.threadId,
    screenshot: "replay.png",
    url: "http://localhost/thread",
    observations: source.replay,
    runRequests: [],
  };
  const appended = [
    ...items,
    {
      id: "result-3",
      kind: "result",
      callId: pending.callId,
      payload: pending.result,
    },
    { id: "final-3", kind: "text", payload: "Approved" },
  ];
  const answered = {
    browser: {
      screenshot: "answer.png",
      action: "click",
      threadId: imported.threadId,
      controlId: pending.id,
    },
    emitted: { answer: "yes", finalResponse: "Approved" },
    native: { identity, items: appended, pending: [] },
    intelligence: { ...imported, items: appended, pending: [] },
  };
  return { source, native, imported, replay, answered, pending };
}

test("shared import preparation preserves pending checkpoints for later rows", async () => {
  const f = fixture();
  f.source.id = "row4-source";
  let imported = false;
  let answered = false;
  const artifacts = [];
  const service = {
    sources: async () => [f.source],
    inspectNative: async () => f.native,
    findImported: async () => (imported ? [f.imported] : []),
    importSource: async () => {
      imported = true;
      return {
        exitCode: 0,
        dryRun: false,
        buildIdentity: "cli-sha",
        command: ["built-cli", "import"],
        log: "import.log",
      };
    },
    readImported: async () => f.imported,
    answer: async () => {
      answered = true;
    },
  };
  const prepared = await prepareImportedSources({
    service,
    namespace: "row4",
    writeArtifact: async (name, record) => artifacts.push({ name, record }),
  });
  assert.equal(answered, false);
  assert.deepEqual(prepared[0].source.expected.pending, [f.pending]);
  assert.deepEqual(prepared[0].native.rawCheckpoint, f.native.rawCheckpoint);
  assert.equal(prepared[0].absentBeforeImport, true);
  assert.deepEqual(artifacts[0].record.before, []);
  await assert.rejects(
    prepareImportedSources({
      service,
      namespace: "row5",
      writeArtifact: async () => {},
    }),
    /namespace/,
  );
  await assert.rejects(
    prepareImportedSources({ service, namespace: "row4", answerPending: true }),
    /must not answer/,
  );
});

test("rejects malformed native checkpoints before importing", () => {
  const f = fixture();
  validateSource(f.source, f.native);
  for (const field of ["nativeOnly", "durable", "completeCheckpoint"]) {
    const source = structuredClone(f.source);
    source.provenance[field] = false;
    assert.throws(() => validateSource(source, f.native));
  }
  const source = structuredClone(f.source);
  const native = structuredClone(f.native);
  source.expected.pending = native.pending = [];
  assert.throws(() => validateSource(source, native), /Orphan native call/);
});

test("detects occurrence loss, order, mapping, state and exact media corruption", () => {
  const f = fixture();
  assertImported(f.source, f.imported);
  const mutations = [
    (x) => x.items.pop(),
    (x) => {
      x.items = x.items.toReversed();
    },
    (x) => x.items.push(x.items[0]),
    (x) => {
      x.nativeIdentity.threadId = "different";
    },
    (x) => {
      x.state.todos[0].description = "lost";
    },
    ...["base64", "mime", "filename"].map((key) => (x) => {
      x.items[1].payload[key] = "corrupt";
    }),
    (x) => {
      x.items[2].id = "wrong-call";
    },
    (x) => {
      x.items[2].payload.args.question = "wrong arguments";
    },
    (x) => {
      x.pending[0].checkpoint = {};
    },
  ];
  for (const mutate of mutations) {
    const imported = structuredClone(f.imported);
    mutate(imported);
    assert.throws(() => assertImported(f.source, imported));
  }
});

test("replay needs observations and must not rerun historical tools", () => {
  const f = fixture();
  assertReplay(f.source, f.imported, f.replay);
  assert.throws(() =>
    assertReplay(f.source, f.imported, { ...f.replay, observations: [] }),
  );
  assert.throws(() =>
    assertReplay(f.source, f.imported, {
      ...f.replay,
      runRequests: ["execute-tool"],
    }),
  );
});

test("pending action must save matching result/final reply and clear both stores on original identity", () => {
  const f = fixture();
  assertAnswered(f.source, f.imported, f.pending, f.answered);
  for (const mutate of [
    (x) => {
      x.native.identity.threadId = "new-empty-session";
    },
    (x) => {
      x.native.pending = [f.pending];
    },
    (x) => {
      x.intelligence.pending = [f.pending];
    },
    (x) => {
      x.native.items.pop();
    },
    (x) => {
      x.intelligence.items[3].callId = "wrong-call";
    },
    (x) => {
      x.browser.controlId = "stale-control";
    },
    (x) => {
      x.emitted.finalResponse = "";
    },
  ]) {
    const answer = structuredClone(f.answered);
    mutate(answer);
    assert.throws(() =>
      assertAnswered(f.source, f.imported, f.pending, answer),
    );
  }
});

test("already-connected source fails before CLI runs and retains evidence", async () => {
  const f = fixture();
  let imported = false;
  const evidence = [];
  const context = {
    fixture: {},
    services: {
      importReplay: {
        sources: async () => [f.source],
        inspectNative: async () => f.native,
        findImported: async () => [f.imported],
        importSource: async () => {
          imported = true;
        },
      },
    },
    writeArtifact: async (name, value) => evidence.push({ name, value }),
  };
  await assert.rejects(row.run(context), /already exists/);
  assert.equal(imported, false);
  assert.match(evidence[0].value.error, /already exists/);
});

test("missing configured services stay blocked instead of passing", async () => {
  assert.equal((await row.run({ services: {} })).status, "blocked");
});

test("preserves repeated complete native call occurrences rather than deduplicating", () => {
  const f = fixture();
  const completed = [
    {
      id: "reused-call",
      kind: "call",
      payload: { name: "chart", args: { points: [1, 2] } },
    },
    {
      id: "first-result",
      kind: "result",
      callId: "reused-call",
      payload: { shown: true },
    },
    {
      id: "reused-call",
      kind: "call",
      payload: { name: "chart", args: { points: [3, 4] } },
    },
    {
      id: "second-result",
      kind: "result",
      callId: "reused-call",
      payload: { shown: true },
    },
  ];
  f.source.expected.items.unshift(...completed);
  f.native.items.unshift(...completed);
  validateSource(f.source, f.native);
  f.imported.items.unshift(...completed);
  assertImported(f.source, f.imported);
  f.imported.items.splice(2, 2);
  assert.throws(() => assertImported(f.source, f.imported));
});

test("environment refusal is blocked with evidence, not a product mismatch", async () => {
  const f = fixture();
  const artifacts = [];
  const report = await row.run({
    fixture: {},
    services: {
      importReplay: {
        sources: async () => [f.source],
        inspectNative: async () => f.native,
        findImported: async () => {
          throw Object.assign(new Error("owned database refused"), {
            code: "ECONNREFUSED",
          });
        },
      },
    },
    writeArtifact: async (name, value) => artifacts.push({ name, value }),
  });
  assert.equal(report.status, "blocked");
  assert.equal(artifacts[0].value.failureClass, "setup");
  assert.ok(report.checks.some((check) => check.status === "unvalidated"));
});

test("native readers cannot mutate expected source data into a false pass", async () => {
  const f = fixture();
  await assert.rejects(
    row.run({
      fixture: {},
      services: {
        importReplay: {
          sources: async () => [f.source],
          inspectNative: async (source) => {
            source.expected.items[0].payload = "corrupted";
            return { ...f.native, items: source.expected.items };
          },
        },
      },
      writeArtifact: async () => {},
    }),
    /Fixture disagrees/,
  );
});
