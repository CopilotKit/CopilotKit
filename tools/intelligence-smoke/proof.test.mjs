import test from "node:test";
import assert from "node:assert/strict";
import * as proof from "./proof.mjs";
const threadId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const insightId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const containerId = "local-proof-test";
const sourceRunId = "55555555-5555-4555-8555-555555555555";
const snapshotId = "019c1234-5678-7890-abcd-123456789abc";
const snapshotMessageIds = [1, 2].map((n) => `${snapshotId}:message:${n}`);
const reference = {
  threadId,
  sourceRunId,
  snapshotId,
  messageIds: snapshotMessageIds,
};
test("thread rejects a successful response returned after its deadline", async () => {
  let now = 0;
  await assert.rejects(
    proof.verifyThread({
      threadId,
      runId,
      userMessageId: "user",
      prompt: "question",
      expectedReply: "answer",
      timeoutMs: 10,
      now: () => now,
      request: async (method) => {
        now += 100;
        return method === "POST"
          ? { threadId, runId }
          : {
              messages: [
                { id: "user", role: "user", content: "question" },
                { id: "reply", role: "assistant", content: "answer" },
              ],
            };
      },
    }),
    /timed out/,
  );
});
test("Learning rejects a successful response returned after its deadline", async () => {
  const { input } = learning();
  let now = 0;
  const original = input.request;
  await assert.rejects(
    proof.verifyLearning({
      ...input,
      timeoutMs: 10,
      now: () => now,
      request: async (...args) => {
        const result = await original(...args);
        now += 100;
        return result;
      },
    }),
    /timed out/,
  );
});
const messageIds = [1, 2].map((n) => `${threadId}:message:${n}`);
const messages = [
  { id: "user", role: "user", content: "question" },
  { id: "assistant", role: "assistant", content: "answer" },
];
function clock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    timeoutMs: 2000,
  };
}
function learning(overrides = {}) {
  let reads = 0;
  const calls = [];
  const insight = {
    id: insightId,
    runId,
    statement: "A statement",
    impact: "An impact",
    evidence: [reference],
  };
  const run = {
    id: runId,
    learningContainerId: containerId,
    projectId: 1,
    status: "succeeded",
    evidenceThreadCount: 1,
    insightCount: 1,
  };
  const binding = {
    operationId,
    containerId,
    status: "committed",
    binding: { boundThreads: 1, conflictingThreads: 0, missingThreads: 0 },
    progress: {
      harvestedRuns: 1,
      pendingRuns: 0,
      unrecoverableRuns: 0,
      skippedRuns: 0,
    },
  };
  const request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.endsWith("/containers"))
      return { container: { id: containerId, projectId: 1 } };
    if (path.endsWith("/thread-binding-operations"))
      return {
        operationId,
        containerId,
        status: "preview",
        preview: {
          selectedThreads: 1,
          conflictingThreads: 0,
          totalRuns: 1,
          ...overrides.preview,
        },
      };
    if (path.includes("/thread-binding-operations/"))
      return {
        ...binding,
        ...overrides.binding,
        progress: { ...binding.progress, ...overrides.progress },
      };
    if (path.endsWith("/runs"))
      return method === "POST"
        ? { run: { ...run, ...overrides.run } }
        : { runs: [{ ...run, ...overrides.run }] };
    if (path.endsWith("/insights")) {
      reads++;
      return {
        insights:
          reads === 1
            ? (overrides.existing ?? [])
            : [
                {
                  ...insight,
                  ...overrides.insight,
                  ...(reads === 3 ? overrides.second : {}),
                },
              ],
      };
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  return {
    calls,
    input: {
      request,
      projectId: "1",
      threadId,
      runId: sourceRunId,
      messageIds,
      containerId,
      ...clock(),
    },
  };
}
test("thread starts real run and waits for persisted reply with positional citations", async () => {
  let reads = 0;
  const calls = [];
  const result = await proof.verifyThread({
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      return method === "POST"
        ? { threadId, runId }
        : { messages: ++reads === 1 ? [] : messages };
    },
    threadId,
    runId,
    userMessageId: "user",
    prompt: "question",
    expectedReply: "answer",
    ...clock(),
  });
  assert.deepEqual(result.messages, messages);
  assert.deepEqual(result.messageIds, messageIds);
  assert.equal(calls[0].path, "/agent/smoke/run");
  assert.deepEqual(calls[0].body, {
    context: [],
    forwardedProps: {},
    messages: [messages[0]],
    runId,
    state: {},
    threadId,
    tools: [],
  });
  assert.equal(calls[1].path, `/api/threads/${threadId}/messages`);
});
for (const saved of [
  [],
  [messages[1]],
  [messages[1], messages[0]],
  [messages[0], { ...messages[1], content: "wrong" }],
]) {
  test(`thread refuses missing or unrelated reply ${JSON.stringify(saved)}`, async () => {
    await assert.rejects(
      proof.verifyThread({
        request: async (method) =>
          method === "POST" ? { threadId, runId } : { messages: saved },
        threadId,
        runId,
        userMessageId: "user",
        prompt: "question",
        expectedReply: "answer",
        ...clock(),
      }),
      /timed out/,
    );
  });
}
test("Learning binds real thread and reads stable persisted output twice", async () => {
  const { input, calls } = learning();
  const result = await proof.verifyLearning(input);
  assert.deepEqual(result.insightIds, [insightId]);
  assert.equal(result.runId, runId);
  assert.equal(result.snapshotId, snapshotId);
  assert.match(result.storedOutputSha256, /^[a-f0-9]{64}$/);
  assert.equal(calls.filter((c) => c.path.endsWith("/insights")).length, 3);
  assert.deepEqual(
    calls.find((c) => c.path.endsWith("/thread-binding-operations")).body,
    { selection: { mode: "explicit", threadIds: [threadId] } },
  );
});
for (const [name, change, error] of [
  ["failed run", { run: { status: "failed" } }, /failed/],
  ["run timeout", { run: { status: "queued" } }, /timed out/],
  [
    "harvest timeout",
    { progress: { harvestedRuns: 0, pendingRuns: 1 } },
    /timed out/,
  ],
  [
    "missing thread",
    {
      binding: {
        binding: { boundThreads: 1, missingThreads: 1, conflictingThreads: 0 },
      },
    },
    /binding/,
  ],
  ["conflict", { preview: { conflictingThreads: 1 } }, /preview/],
  ["skipped harvest", { progress: { skippedRuns: 1 } }, /harvest/],
  ["unrecoverable harvest", { progress: { unrecoverableRuns: 1 } }, /harvest/],
  ["empty statement", { insight: { statement: "  " } }, /output/],
  ["empty impact", { insight: { impact: "" } }, /output/],
  [
    "invented citation",
    {
      insight: {
        evidence: [{ ...reference, messageIds: [`${snapshotId}:message:999`] }],
      },
    },
    /evidence/,
  ],
  [
    "wrong thread",
    { insight: { evidence: [{ ...reference, threadId: "other" }] } },
    /evidence/,
  ],
  ["wrong run", { insight: { runId: operationId } }, /output/],
  ["empty evidence", { insight: { evidence: [] } }, /evidence/],
  ["changed persisted result", { second: { impact: "Changed" } }, /changed/],
  ["existing output", { existing: [{}] }, /new Learning Container/],
])
  test(`Learning rejects ${name}`, async () => {
    await assert.rejects(proof.verifyLearning(learning(change).input), error);
  });
test("thread follows the canonical runtime thread and run IDs", async () => {
  const paths = [];
  const result = await proof.verifyThread({
    request: async (method, path) => {
      paths.push(path);
      return method === "POST"
        ? { threadId: operationId, runId: insightId }
        : { messages };
    },
    threadId,
    runId,
    userMessageId: "user",
    prompt: "question",
    expectedReply: "answer",
    ...clock(),
  });
  assert.equal(result.threadId, operationId);
  assert.equal(result.runId, insightId);
  assert.equal(paths[1], `/api/threads/${operationId}/messages`);
  assert.deepEqual(
    result.messageIds,
    [1, 2].map((n) => `${operationId}:message:${n}`),
  );
});
test("thread surfaces runtime refusal instead of polling", async () => {
  let calls = 0;
  await assert.rejects(
    proof.verifyThread({
      request: async () => {
        calls++;
        throw new Error("HTTP 502");
      },
      threadId,
      runId,
      userMessageId: "user",
      prompt: "question",
      expectedReply: "answer",
      ...clock(),
    }),
    /HTTP 502/,
  );
  assert.equal(calls, 1);
});
test("Learning rejects a disappeared accepted run", async () => {
  const { input } = learning({ run: { status: "queued" } });
  const original = input.request;
  input.request = async (method, path, body) =>
    method === "GET" && path.endsWith("/runs")
      ? { runs: [] }
      : original(method, path, body);
  await assert.rejects(proof.verifyLearning(input), /disappeared/);
});
test("Learning waits for harvest and run completion before reading output", async () => {
  const { input, calls } = learning();
  input.timeoutMs = 3000;
  const original = input.request;
  input.request = async (method, path, body) => {
    const result = await original(method, path, body);
    if (method === "POST" && path.endsWith("/commit"))
      result.progress = {
        ...result.progress,
        harvestedRuns: 0,
        pendingRuns: 1,
      };
    if (method === "POST" && path.endsWith("/runs"))
      result.run = { ...result.run, status: "queued" };
    return result;
  };
  await proof.verifyLearning(input);
  assert.ok(
    calls.some(
      (c) =>
        c.method === "GET" &&
        c.path.endsWith(`/thread-binding-operations/${operationId}`),
    ),
  );
  assert.ok(calls.some((c) => c.method === "GET" && c.path.endsWith("/runs")));
});

for (const [name, change] of [
  ["wrong source run", { sourceRunId: operationId }],
  ["missing source run", { sourceRunId: undefined }],
  ["invalid snapshot", { snapshotId: "not-a-uuid" }],
  ["missing snapshot", { snapshotId: undefined }],
  ["wrong snapshot citation", { messageIds: [`${operationId}:message:1`] }],
  ["old thread citation", { messageIds }],
  ["omitted assistant citation", { messageIds: [snapshotMessageIds[0]] }],
  [
    "duplicated user citation",
    { messageIds: [snapshotMessageIds[0], snapshotMessageIds[0]] },
  ],
  [
    "extra duplicate citation",
    { messageIds: [...snapshotMessageIds, snapshotMessageIds[1]] },
  ],
  ["noncanonical position", { messageIds: [`${snapshotId}:message:01`] }],
])
  test(`Learning rejects ${name}`, async () => {
    await assert.rejects(
      proof.verifyLearning(
        learning({ insight: { evidence: [{ ...reference, ...change }] } })
          .input,
      ),
      /evidence/,
    );
  });
